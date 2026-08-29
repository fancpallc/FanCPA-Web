# Client Info Feature – Implementation Plan

> **Scope**: Do not edit implementation yet. This doc is the executable plan for:
> - GDrive folder per client email + year subfolder, only owner + client have access
> - Drive link sent in confirmation email
> - Public client portal (email lookup + Turnstile -> email with drive link)
> - Admin client portal (search by email/first/last, editable drive link, send button for upcoming meetings + drive link)

**Repo**: Vite + React SPA, Cloudflare Pages Functions (D1 fancpa-db, R2), Resend emails, Google Calendar SA+OAuth.

---

## 1. Data Model

### Existing baseline (relevant)
- `contacts(id, first_name, last_name, email UNIQUE, phone, drive_folder_url TEXT, created_at)`
  - `drive_folder_url` exists since 0001 but never populated – legacy template column.
- `bookings(id, contact_id, calendar_event_id, purpose, cancel_token UNIQUE, status, slot_start, slot_end, created_at)`
  - `slot_start/end` added in 0007, `time_zone` missing in bookings (only in pending_bookings via 0011)
- `pending_bookings(..., time_zone, purpose, ...)`

### New migration: `migrations/0014_client_drive_folders.sql`

```sql
-- Client drive folders per year
CREATE TABLE client_drive_folders (
  id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(8)))),
  contact_id TEXT NOT NULL REFERENCES contacts(id) ON DELETE CASCADE,
  email TEXT NOT NULL, -- lowercased
  year INTEGER NOT NULL CHECK (year >= 2000 AND year <= 2100),
  folder_id TEXT NOT NULL, -- Drive id for YEAR folder
  folder_url TEXT NOT NULL, -- https://drive.google.com/drive/folders/<id> or webViewLink
  parent_folder_id TEXT, -- email folder id
  parent_folder_url TEXT,
  is_manual INTEGER DEFAULT 0, -- 1 if admin edited
  created_at TEXT DEFAULT (datetime('now')),
  updated_at TEXT DEFAULT (datetime('now')),
  UNIQUE(contact_id, year)
);
CREATE INDEX idx_cdf_email ON client_drive_folders(email);
CREATE INDEX idx_cdf_contact_year ON client_drive_folders(contact_id, year);
CREATE INDEX idx_cdf_year ON client_drive_folders(year);

-- bookings needs meet_link persisted and timezone for admin display
ALTER TABLE bookings ADD COLUMN meet_link TEXT;
ALTER TABLE bookings ADD COLUMN time_zone TEXT;
ALTER TABLE bookings ADD COLUMN drive_folder_url TEXT; -- denormalized year folder link at booking time
```

**Why**:
- `client_drive_folders` stores year subfolder, not just email root. Allows multiple years per client.
- `bookings.meet_link` was generated but never stored – admin portal requirement "meeting url" display. Now persisted.
- `bookings.time_zone` + `drive_folder_url` denormalized for fast admin listing without extra joins.

**Backfill note**: Legacy rows get NULL meet_link – admin UI shows fallback "Legacy – not recorded".

### New migration: `migrations/0015_client_drive_link.sql` (Revision 2)

The Drive link the admin and the client care about is the **email root folder** – it is 1:1 with the
client, and the per-year folders live inside it. `client_drive_folders` stays as the per-year record
(needed for reuse/creation), but the client-level link gets a single authoritative home on `contacts`.

```sql
ALTER TABLE contacts ADD COLUMN drive_folder_id TEXT;      -- email root folder Drive id
ALTER TABLE contacts ADD COLUMN drive_is_manual INTEGER DEFAULT 0; -- 1 if admin overrode the link
CREATE INDEX idx_contacts_drive_folder_id ON contacts(drive_folder_id);
CREATE INDEX idx_cdf_folder_id ON client_drive_folders(folder_id);
CREATE INDEX idx_cdf_parent_folder_id ON client_drive_folders(parent_folder_id);
```

`contacts.drive_folder_url` (legacy column, populated since PR-3) becomes the client-level link.
The two new indexes on `client_drive_folders` support **admin lookup by Drive link** (§7).

**Why not keep the link only on `client_drive_folders`?**
That table is keyed `(contact_id, year)`, so "the client's Drive link" had no single row – the admin UI
had to guess a year, and the admin search `LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id`
(no year correlation) fanned every booking row out once per year folder. One column on `contacts` fixes
both.

---

## 2. New Backend Lib: `functions/_lib/google-drive.ts`

**Purpose**: Parallel to `google-calendar.ts`, handles Drive folder creation + sharing.

**Env vars** (via `env.ts` getters):
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` aliases: `DRIVE_ROOT_FOLDER_ID`, `GDRIVE_ROOT_FOLDER_ID`, `DRIVE_ROOT`
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` aliases: `DRIVE_SERVICE_ACCOUNT_KEY`, reuse `GCAL_SERVICE_ACCOUNT_KEY` fallback
- Owner email for skip-share logic: derived from `ADMIN_EMAILS` first entry or `GOOGLE_DRIVE_OWNER_EMAIL`

**APIs**:
```ts
export interface DriveEnv { DB?, GOOGLE_DRIVE_ROOT_FOLDER_ID?, GCAL_SERVICE_ACCOUNT_KEY?, GOOGLE_SERVICE_ACCOUNT_KEY?, DRIVE_SERVICE_ACCOUNT_KEY?, GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY?, GOOGLE_OAUTH_CLIENT_ID?, ... }

export interface DriveFolderResult {
  emailFolderId: string; emailFolderUrl: string;
  yearFolderId: string; yearFolderUrl: string; // link sent to client
  source: 'live' | 'stub';
  error?: string;
}

export async function getDriveAccessToken(env): Promise<{token:string, source, error?}>
  - Try OAuth refresh_token flow if hasOAuthConfig() – scope https://www.googleapis.com/auth/drive
  - Else SA JWT with scope https://www.googleapis.com/auth/drive
  - Reuse RS256 signing code from google-calendar.ts

export async function searchFolder(name, parentId, token): Promise<{id, webViewLink}|null>
  q = `mimeType='application/vnd.google-apps.folder' and name='${escaped}' and '${parentId}' in parents and trashed=false`

export async function createFolder(name, parentId, token): Promise<{id, webViewLink}>

export async function ensurePermission(folderId, email, token, role='writer')
  - GET permissions, check existing, POST if needed
  - Skip if email == owner admin email
  - Returns {alreadyShared:boolean}

export async function ensureClientDriveFolder(env, emailRaw, yearRaw, opts?: {parentFolderId?: string}): Promise<DriveFolderResult>
  1. Normalize email lowercased, validate email regex.
  2. Year = parseInt(yearRaw,10); validate 4-digit 2000-2100 else use current year.
  3. If local/test or STUB or missing key -> stub: fake ids `fake-${email}-${year}` and link `https://drive.google.com/drive/folders/fake-...`
  4. Else token
  5. RootId = getDriveRootFolderId(env) || 'root'
  6. emailFolder = opts.parentFolderId ? {id: opts.parentFolderId}   // admin override, see below
                                       : searchFolder(email, rootId) || createFolder(email, rootId)
  7. ensurePermission(emailFolder.id, email)
  8. yearFolder = searchFolder(String(year), emailFolder.id) || createFolder(String(year), emailFolder.id)
  9. ensurePermission(yearFolder.id, email)
 10. Return both.

Logging: `!!! DRIVE_*` like calendar.
```

**Which year?** `yearRaw` is always the **meeting's** year – `new Date(slot_start).getFullYear()` – never
`new Date().getFullYear()`. A booking made in Dec 2026 for a Jan 2027 slot files under `2027`. The
current-year fallback in step 2 only applies when `yearRaw` is absent or out of range.

**`opts.parentFolderId` (Revision 2)**: when the admin has overridden a client's Drive link
(`contacts.drive_is_manual = 1`), callers pass `contacts.drive_folder_id` here so new year folders are
created **inside the folder the admin chose** rather than under `<root>/<email>`. Without this the
override would be cosmetic – the admin link would point at folder A while confirmations kept filing
documents into folder B. Callers (`booking/confirm`, `admin/bookings/manual`) resolve it with:

```ts
const contact = await db.prepare('SELECT drive_folder_id, drive_is_manual FROM contacts WHERE id=?').bind(contactId).first()
const parentFolderId = contact?.drive_is_manual ? contact.drive_folder_id : undefined
```

**Stub behavior**: For `ENVIRONMENT=local|test` or missing key, return mock but with realistic URL so email template still renders.

**File diff – NEW**:
- `functions/_lib/google-drive.ts` – ~350 lines, new file, no diff vs existing but pattern mirrors calendar.

---

## 3. Env Helpers – `functions/_lib/env.ts`

### Diff

```diff
 const BOOKING_LIMIT_ENABLED_ALIASES = [...]
+const DRIVE_ROOT_ALIASES = ['GOOGLE_DRIVE_ROOT_FOLDER_ID','DRIVE_ROOT_FOLDER_ID','GDRIVE_ROOT_FOLDER_ID','DRIVE_ROOT','DRIVE_FOLDER_ID']
+const DRIVE_KEY_ALIASES = ['GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY','DRIVE_SERVICE_ACCOUNT_KEY','GCAL_SERVICE_ACCOUNT_KEY','GOOGLE_SERVICE_ACCOUNT_KEY']
+const DRIVE_OWNER_ALIASES = ['GOOGLE_DRIVE_OWNER_EMAIL','DRIVE_OWNER_EMAIL','ADMIN_EMAIL']

 export function getBookingCalendarId...
+export function getDriveRootFolderId(env): string|undefined { return resolveEnvVar(env, DRIVE_ROOT_ALIASES) }
+export function getDriveServiceKey(env): string|undefined { return resolveEnvVar(env, DRIVE_KEY_ALIASES) }
+export function getDriveOwnerEmail(env): string|undefined { return resolveEnvVar(env, DRIVE_OWNER_ALIASES) }
```

**Tests**:

- Add in `functions/_lib/env.test.ts` 4 cases for drive aliases.

---

## 4. Email Lib – `functions/_lib/email.ts`

### Current
- `buildConfirmationEmail({firstName,lastName,email,meetLink,cancelUrl,dateTime,purpose})`
- `buildPendingConfirmEmail`
- `sendConfirmationEmail`, `sendPendingConfirmEmail`

### Proposed diff

```diff
 export interface SendEmailParams {
   to: string
   firstName: string
   lastName: string
   meetLink: string
   cancelUrl: string
   dateTime: string
   purpose?: string
+  driveLink?: string
+  driveYear?: number
   env: EmailEnv
 }

 export function buildConfirmationEmail(params: {
   firstName, lastName, email, meetLink, cancelUrl, dateTime, purpose?, driveLink?, driveYear?, env?
 }): string {
   ...
+  const driveBlock = driveLink ? `
+      <div style="margin:16px 0;padding:12px;border:1px solid #e2e8f0;border-radius:8px;background:#f8fafc;">
+        <p style="margin:0 0 4px;font-weight:600;">Upload documents (${driveYear || 'current year'}):</p>
+        <p style="margin:0;"><a href="${driveLink}">${driveLink}</a></p>
+        <p style="margin:4px 0 0;font-size:12px;color:#64748b;">Only you and our team have access. Folder: ${driveYear || ''}</p>
+      </div>` : ''
   return `
     <div...>...${purpose block}...<p>Email...</p>...${driveBlock}
     ...
 }

+export function buildClientPortalDriveEmail({firstName, email, driveLinks: {year,url}[], env}): string
+export function buildAdminDriveEmail({firstName, driveLink, meetings: {dateTime, meetLink, purpose, timeZone}[], env}): string
+export interface ClientPortalEmailParams { to, firstName, driveLinks, env }
+export async function sendClientPortalDriveEmail(params): Promise<SendEmailResult>
+export interface AdminDriveEmailParams { to, firstName, driveLink, meetings, env }
+export async function sendAdminDriveEmail(params): Promise<SendEmailResult>
```

- Confirmation email now optionally includes Drive link.
- Client portal email lists all year folders: "Your document folders: 2025: link, 2026: link"
- Admin email lists upcoming meetings table + drive link.

### Revision 2 – meetings, cancel links, cancellation notice

Three gaps against the product intent: the client-portal email carried folder links only (no meetings,
no cancel links), the admin email rendered meetings as `meetings.join(', ')` over raw ISO strings, and
nothing notified the client when a booking was cancelled.

**Shared meeting shape** – both portal emails render the same rows, so build it once:

```ts
export interface EmailMeeting {
  dateTime: string      // pre-formatted in the client's time_zone by the caller
  timeZone?: string
  purpose?: string
  meetLink?: string     // null for legacy rows -> render "Not recorded"
  cancelUrl?: string    // `${origin}/api/cancel/${cancel_token}`
}
export function renderMeetingRows(meetings: EmailMeeting[]): string
```

`cancelUrl` reuses the existing `bookings.cancel_token` and the live `/api/cancel/[token]` endpoint –
no new cancellation surface, no new token type.

**Changed signatures**:

```diff
-export function buildClientPortalDriveEmail(params: { firstName, driveLinks: {year,url}[] }): string
+export function buildClientPortalDriveEmail(params: {
+  firstName: string
+  driveFolderUrl?: string              // client-level email root folder (1:1 with the client)
+  yearFolders: { year: number; url: string }[]
+  meetings: EmailMeeting[]             // upcoming only, ascending
+}): string
+// Renders, in order: greeting -> "Your documents folder" (driveFolderUrl + per-year links)
+// -> "Your upcoming meetings" table (date/time, purpose, join link, cancel link)
+// -> empty states: "No upcoming meetings" / "Your folder will be created with your first booking"

-export function buildAdminDriveEmail(params: { firstName, driveLink, meetings: string[] }): string
+export function buildAdminDriveEmail(params: {
+  firstName: string
+  driveLink: string
+  meetings: EmailMeeting[]             // only the meetings the admin ticked
+}): string

+export function buildBookingCancelledEmail(params: {
+  firstName: string
+  dateTime: string
+  purpose?: string
+  driveFolderUrl?: string
+}): string
+export async function sendBookingCancelledEmail(params: {
+  to, firstName, dateTime, purpose?, driveFolderUrl?, env
+}): Promise<SendEmailResult>
```

`buildBookingCancelledEmail` states the meeting is cancelled, that no action is needed, and that the
documents folder is unchanged and still accessible. It carries **no** cancel link (nothing left to
cancel) and no meet link.

**Stub behavior** same as existing – if no RESEND key, return mock success.

**Regression to fix while here**: `sendClientPortalDriveEmail` / `sendAdminDriveEmail` lost their
`!!! *_EMAIL_*` logs and their `if (!res.ok)` error branch in PR-2, so a Resend 4xx currently returns
`{success: true}`. Restore both to match `sendConfirmationEmail`.

### Tests – `functions/_lib/email.test.ts`

Add:
```ts
it('confirmation includes drive link when provided', () => {
  const html = buildConfirmationEmail({..., driveLink:'https://drive.google.com/drive/folders/xyz', driveYear:2026})
  expect(html).toContain('drive.google.com')
  expect(html).toContain('2026')
})
it('client portal email lists multiple years', () => {
  const html = buildClientPortalDriveEmail({firstName:'Jane', email:'j@e.com', driveLinks:[{year:2025,url:'link1'},{year:2026,url:'link2'}]})
  expect(html).toContain('2025')
  expect(html).toContain('link1')
})
```

---

## 5. Booking Confirm Flow – `functions/api/booking/confirm/[token].ts`

### Current flow
1. Lookup pending
2. Check expiry, create Google Calendar event -> meetLink, calendarEventId
3. Insert into bookings (calendar_event_id, purpose, cancel_token, slot_start/end)
4. Delete pending
5. Send confirmation email with meetLink.

### Proposed diff

```diff
+import { ensureClientDriveFolder } from '../../../_lib/google-drive'
+import { getDriveRootFolderId, getDriveServiceKey } from '../../../_lib/env'

 // after booking insert
+let driveResult: any = null
+let driveLink: string | null = null
+try {
+  const meetingYear = new Date(pending.slot_start).getFullYear()
+  console.log(`!!! CONFIRM_DRIVE_CREATE_START email=${pending.email} year=${meetingYear}`)
+  driveResult = await ensureClientDriveFolder(env, pending.email, meetingYear, contactId)
+  driveLink = driveResult?.yearFolderUrl || null
+  console.log(`!!! CONFIRM_DRIVE_CREATE_RESULT yearLink=${driveLink} source=${driveResult?.source}`)
+  // upsert into client_drive_folders
+  const emailFolderUrl = driveResult?.emailFolderUrl
+  const upsertDrive = db.prepare(`
+    INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, parent_folder_id, parent_folder_url, created_at, updated_at)
+    VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, datetime('now'), datetime('now'))
+    ON CONFLICT(contact_id, year) DO UPDATE SET folder_id=excluded.folder_id, folder_url=excluded.folder_url, parent_folder_id=excluded.parent_folder_id, parent_folder_url=excluded.parent_folder_url, updated_at=datetime('now')
+  `)
+  await upsertDrive.bind(contactId, pending.email.toLowerCase(), meetingYear, driveResult.yearFolderId, driveResult.yearFolderUrl, driveResult.emailFolderId, emailFolderUrl).run()
+  // update contacts.drive_folder_url legacy
+  await db.prepare('UPDATE contacts SET drive_folder_url=?1 WHERE id=?2').bind(emailFolderUrl, contactId).run().catch(()=>{})
+  // update bookings row with drive + meet + timezone
+  await db.prepare('UPDATE bookings SET meet_link=?1, time_zone=?2, drive_folder_url=?3 WHERE id=?4').bind(meetLink, pending.time_zone || null, driveLink, bookingId).run().catch(()=>{})
+} catch (e:any) {
+  console.log(`!!! CONFIRM_DRIVE_CREATE_ERROR ${e?.message} – non-blocking`)
+}

 // send email
-const emailResult = await sendConfirmationEmail({..., meetLink, cancelUrl, dateTime, purpose})
+const emailResult = await sendConfirmationEmail({..., meetLink, cancelUrl, dateTime, purpose, driveLink, driveYear: meetingYear, env})
```

**Non-blocking**: If Drive fails, booking still succeeds, email sent without drive link, log error. Admin can later manually create.

**meet_link column**: Need to capture from earlier `meetLink` variable and persist.

---

## 6. Public Client Portal – New Endpoint + Page

### Backend `functions/api/client-portal/lookup.ts` (NEW)

```ts
// POST {email, turnstileToken}
// - verifyTurnstile(token, secret, env)
// - lower email, validate
// - SELECT contacts where email=?
// - If not found: return {success:true, message:"If your email exists..."} generic (to prevent enumeration) with 200
// - If found:
//     SELECT drive_folder_url FROM contacts WHERE id=?                          -- client-level link
//     SELECT year, folder_url FROM client_drive_folders WHERE contact_id=? ORDER BY year DESC
//     SELECT id, slot_start, slot_end, time_zone, purpose, meet_link, cancel_token
//       FROM bookings
//      WHERE contact_id=? AND status='confirmed' AND datetime(slot_start) >= datetime('now')
//      ORDER BY slot_start ASC                                                  -- upcoming meetings
// - Map each booking to EmailMeeting: dateTime formatted in booking.time_zone (fallback America/New_York),
//   cancelUrl = `${new URL(request.url).origin}/api/cancel/${cancel_token}`
// - ALWAYS send when the contact exists — even with zero folders and zero meetings.
//   The email renders its own empty states. (Rev 2: previously gated on driveLinks.length,
//   so a client with meetings but no folder silently received nothing.)
// - Send via sendClientPortalDriveEmail({firstName, driveFolderUrl, yearFolders, meetings})
// - Return {success:true} with the same generic message as the not-found branch

Edge:
- Turnstile required, same pattern as bookings/lookup.ts:49-65
- Rate limit: optional 5 req/min per IP via simple in-memory? For now rely on Turnstile + generic response.
- Logging: !!! CLIENT_PORTAL_LOOKUP ...
```

### Frontend `src/pages/ClientPortal.tsx` (NEW)

```jsx
export function ClientPortal():
  - Layout wrapper with Nav/Footer? Use Layout.
  - State: email, turnstileToken, submitting, message, error
  - Turnstile mount: #client-portal-turnstile-widget, renderTurnstile() logic copy from BookingForm.tsx 24-136 + ManageBookings.tsx
  - Form submit -> POST /api/client-portal/lookup
  - UX: Input email, button "Send my upload link"
  - After success: show green box "If your email is registered, we've sent your Drive link."
  - Include back to home link.

Reuse BookingForm turnstile pattern:
// global var window.turnstile
// callback: setTurnstileToken(token)
// expired-callback: clear
```

**Tests**:
- `functions/api/client-portal/lookup.test.ts` (NEW) – similar to bookings/lookup.test.ts:
  - Turnstile stub in local env passes
  - Returns 200 even when email not found (enumeration protection)
  - When contact + folders found, calls Resend mock and returns success
  - Mock D1 for contacts + client_drive_folders
- Frontend: `src/pages/ClientPortal.test.tsx`:
  - Renders email input + turnstile container
  - Submit disabled when no token
  - Shows success message after API returns

### Routing `src/App.tsx`

```diff
 import { Health } from './pages/Health'
 import { Admin } from './pages/Admin'
+import { ClientPortal } from './pages/ClientPortal'
+import { AdminClients } from './pages/AdminClients'

 if (path.startsWith('/health')) return <Health />
+if (path.startsWith('/client-portal')) return <ClientPortal />
+if (path.startsWith('/admin/clients')) return <AdminClients />
 if (path.startsWith('/admin')) return <Admin />
 return <Layout><Home/></Layout>
```

---

## 7. Admin Client Portal

### Backend Search `functions/api/admin/clients/search.ts` (NEW)

```ts
GET /api/admin/clients/search?q=... 
Auth: requireAdminAuth via auth.ts (Cloudflare Access JWT or bypass in local)

Query params: q, start_date, end_date

MATCHING (Rev 2 – q also accepts a Drive link or bare folder id):
  const folderId = extractFolderId(q) || (/^[A-Za-z0-9_-]{20,}$/.test(q) ? q : null)
  if (folderId) match on:  c.drive_folder_id = folderId
                        OR EXISTS (SELECT 1 FROM client_drive_folders x
                                    WHERE x.contact_id = c.id
                                      AND (x.folder_id = folderId OR x.parent_folder_id = folderId))
  else match on lower(email|first_name|last_name) LIKE '%q%' ESCAPE '\'

SQL – contacts first, then meetings; never join contacts x bookings x folders in one pass:
  -- 1. matched contacts (client-level Drive link lives on contacts, 1:1)
  SELECT c.id as contact_id, c.first_name, c.last_name, c.email, c.phone,
         c.drive_folder_url, c.drive_folder_id, c.drive_is_manual
  FROM contacts c WHERE <match> LIMIT 50

  -- 2. their year folders
  SELECT contact_id, year, folder_url, folder_id, is_manual
  FROM client_drive_folders WHERE contact_id IN (...) ORDER BY year DESC

  -- 3. their meetings, with the date filter applied here
  SELECT contact_id, id as booking_id, calendar_event_id, meet_link, purpose,
         slot_start, slot_end, time_zone, status, cancel_token
  FROM bookings
  WHERE contact_id IN (...) AND status='confirmed'
    [AND datetime(slot_start) >= datetime(?start_date)]
    [AND datetime(slot_start) <= datetime(?end_date)]
  ORDER BY slot_start DESC LIMIT 500

Response (Rev 2 – grouped, replaces the flat `results` array):
{
  clients: [{
    contact_id, first_name, last_name, email, phone,
    drive_folder_url, drive_folder_id, drive_is_manual,   // <- the one link rendered at the top
    year_folders: [{year, folder_url, folder_id, is_manual}],
    meetings:     [{booking_id, slot_start, slot_end, meet_link, purpose,
                    time_zone, status, calendar_event_id, cancel_token}]
  }]
}
```

**Why grouped, and why the flat shape had to go**: the shipped implementation joins
`contacts LEFT JOIN bookings LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id` with no year
correlation on the folder join, so a client with 3 year folders and 4 meetings returns 12 rows – every
meeting duplicated once per folder. Grouping by contact removes the fan-out and gives the UI the exact
shape it needs: one client header (name, email, **one** Drive link) over N meeting rows.

**Date filter semantics**: filtering on `slot_start` now narrows the *meetings* list only. A matched
client with no meetings in range still appears, with an empty meetings list and their Drive link intact
– previously the `AND datetime(b.slot_start) >= ...` on a LEFT JOIN silently dropped the whole client.

Auth checks same as `functions/api/admin/content.ts`.

### Backend Editable `functions/api/admin/clients/drive-folder.ts` (NEW)

```
PATCH /api/admin/clients/drive-folder
Auth: admin
Validate: contact_id exists, folder_url matches
          /^https:\/\/drive\.google\.com\/(drive\/folders|file\/d)\/([A-Za-z0-9_-]+)/
          -> folder_id = match[2]

Two modes, discriminated by the presence of `year`:

A. CLIENT-LEVEL (Rev 2, the default the UI uses) — Body: {contact_id, folder_url}
   UPDATE contacts SET drive_folder_url=?, drive_folder_id=?, drive_is_manual=1 WHERE id=?
   Also refresh the denormalized parent on existing year rows so they stay consistent:
   UPDATE client_drive_folders SET parent_folder_id=?, parent_folder_url=?, updated_at=datetime('now')
    WHERE contact_id=?
   Does NOT rewrite per-year folder_url — those subfolders still exist under the old parent; new years
   get created under the override via ensureClientDriveFolder's `opts.parentFolderId` (§2).

B. YEAR-LEVEL (kept for repointing one year's folder) — Body: {contact_id, year, folder_url}
   Validate year /^\d{4}$/ and 2000..2100
   UPSERT client_drive_folders (contact_id, year, folder_url, folder_id, is_manual=1)

GET ?contact_id=            -> {drive_folder_url, drive_folder_id, drive_is_manual, year_folders:[...]}
GET ?contact_id=&year=      -> single year row

Errors: 400 bad url / bad year, 401 unauthed, 404 contact not found
```

### Backend Send Email `functions/api/admin/clients/send-email.ts` (NEW)

```
POST /api/admin/clients/send-email
Body: {contact_id, booking_ids?: string[]}        // Rev 2: booking_ids = the ticked checkboxes
Auth: admin
Logic:
- Fetch contact -> 404 if missing
- Candidate meetings: SELECT id, slot_start, slot_end, meet_link, purpose, time_zone, cancel_token
    FROM bookings WHERE contact_id=? AND status='confirmed'
      AND datetime(slot_start) >= datetime('now') ORDER BY slot_start ASC
- Selection:
    booking_ids omitted/empty -> send ALL upcoming (backward compatible with PR-5)
    booking_ids provided      -> keep only those ids; every id MUST be in the candidate set,
                                 otherwise 400 {error:'booking_ids must belong to contact_id and be upcoming'}
                                 (prevents forwarding another client's meeting by id)
- Drive link: contacts.drive_folder_url (client-level, 1:1) — falls back to the newest
    client_drive_folders.folder_url only when the contacts column is NULL (legacy rows)
- Map to EmailMeeting: dateTime formatted in booking.time_zone, cancelUrl from cancel_token
- If the selection is empty, still send — the folder link alone is useful
- sendAdminDriveEmail({to, firstName, driveLink, meetings})
- Return {success, sentTo, meetingsCount, driveLink, emailResult}

Logging: !!! ADMIN_CLIENT_SEND email=... selected=<n>/<total>
```

### Frontend `src/pages/AdminClients.tsx` (NEW)

State:
- auth via `useAdminAuth()`
- query input, searching, results, error
- editingDrive: {contact_id, year, url} temp

UI (Rev 2 – one card per client: Drive link on top, meetings as rows underneath):

```
┌ Sticky toolbar: Admin Client Portal | + Add Booking | Back to Admin | View site ─────────┐
├ Search card: [q] [From] [To] [Search]                                                     │
│   q placeholder: "Email, first name, last name, or Drive link"                            │
└───────────────────────────────────────────────────────────────────────────────────────────┘

┌ CLIENT CARD — one per contact ────────────────────────────────────────────────────────────┐
│  Jane Doe · jane@abc.com · +1…                                    [Send selected (2)]     │
│  GDrive:  [ https://drive.google.com/drive/folders/XYZ        ] [Save]  ✎ manual          │
│           Year folders: 2025 ↗  2026 ↗                                                    │
├───────────────────────────────────────────────────────────────────────────────────────────┤
│  [x] │ Meeting time (client TZ) │ Purpose │ TZ  │ Meeting URL │ Status   │ Actions        │
│  [x] │ 2026-03-15 13:00 EDT     │ Tax     │ ET  │ meet ↗      │ upcoming │ [Delete]       │
│  [ ] │ 2026-01-02 09:00 EST     │ Intake  │ ET  │ meet ↗      │ past     │ [Delete]       │
└───────────────────────────────────────────────────────────────────────────────────────────┘
```

- **GDrive link is client-level and rendered once at the top of the card**, not per meeting row —
  it is 1:1 with the client's email. `Save` calls PATCH `{contact_id, folder_url}` (no `year`).
  Removes the previous bug where the per-row input was keyed by `contact_id` alone, so editing one row
  visually changed every row for that client and `handleSave` fell back to `new Date().getFullYear()`
  when `r.year` was undefined — writing the link to the wrong year.
- **Checkbox per meeting row** + a header checkbox that selects all *upcoming* meetings for that client.
  Past meetings are selectable but unticked by default. `Send selected (n)` posts
  `{contact_id, booking_ids}`; it is disabled at n=0 with tooltip "Tick the meetings to forward".
- Selection state is per client: `selected: Record<contactId, Set<bookingId>>`. Cleared on new search.
- Empty states: "No clients found" / per card "No meetings in the selected range".

State:
- `selected: Record<string, Set<string>>`, `editingDrive: Record<contactId, string>`,
  `deleteTarget: {client, meeting} | null`, `cancelMeetingChecked`, `notifyClientChecked`

Error handling: show banner for globalError.

**Component split**: `src/components/admin/ClientCard.tsx` (header + Drive editor + meetings table).
`AdminClients.tsx` is already ~210 lines and gains selection, grouping and a second modal.

### Backend Add Record `functions/api/admin/bookings/manual.ts`

Admin-created booking; previously absent from this plan (shipped in PR-7) — recorded here for completeness.

```
POST {first_name,last_name,email,phone?,purpose?,slot_start ISO,slot_end ISO,time_zone?,
      sendEmail?:boolean, drive_folder_url?:override}
Auth: admin
- validate required + email regex + slot_start < slot_end
- upsert contact by email
- meetingYear = new Date(slot_start).getFullYear()
- driveResult = ensureClientDriveFolder(env, email, meetingYear, {parentFolderId})   // §2 override
- createBookingEvent -> meetLink + calendarEventId (blocks the calendar)
- INSERT bookings (… meet_link, time_zone, drive_folder_url, cancel_token, status='confirmed')
- if sendEmail: sendConfirmationEmail({… driveLink, driveYear: meetingYear, cancelUrl})
- Return {success, bookingId, meetLink, driveLink, calendarEventId}
```

### Backend Delete/Cancel `functions/api/admin/bookings/[id].ts`

```
DELETE /api/admin/bookings/:id?cancelMeeting=true|false&notifyClient=true|false
Auth: admin  ← MUST ADD. The shipped endpoint has no isAdminAuthenticated() call at all,
              so any unauthenticated caller can delete any booking by id. Fix in PR-10.
- SELECT booking (+ join contacts for email/first_name) -> 404 if missing
- if cancelMeeting && calendar_event_id: deleteBookingEvent on booking + personal calendars (ignore 404)
- Rev 2 — if notifyClient (defaults to the value of cancelMeeting):
    sendBookingCancelledEmail({to: contact.email, firstName, dateTime formatted in booking.time_zone,
                               purpose, driveFolderUrl: contacts.drive_folder_url, env})
    Non-blocking: a Resend failure must not abort the delete. Log !!! ADMIN_CANCEL_NOTIFY_ERROR.
- DELETE FROM bookings WHERE id=?    (client_drive_folders untouched — never delete Drive data)
- Return {success, cancelled, notified}
```

**Why `notifyClient` is separate from `cancelMeeting`**: deleting a mistyped test record should not
email a real client, and freeing the calendar without telling the client is a legitimate back-office
action. Defaulting `notifyClient` to `cancelMeeting` keeps the common path one click.

### Admin main page button `src/pages/Admin.tsx`

```diff
 <div className="flex flex-wrap gap-2 items-center">
+  <a href="/admin/clients" className="px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-[11px] font-semibold hover:border-slate-900">Client Portal</a>
   <button onClick={handleCheckQuota}...>Check storage</button>
   <button onClick={()=>{refetch(); content.refetch()}}>Refresh</button>
   <a href="/"...>View site</a>
 </div>
```

### API helpers `src/lib/api.ts`

```diff
+export interface ClientDriveFolder { year:number, folder_id:string, folder_url:string, parent_folder_id?:string, parent_folder_url?:string }
+export interface AdminClientRow { contact_id:string, first_name:string, last_name:string, email:string, phone?:string, booking_id?:string, calendar_event_id?:string, meet_link?:string, purpose?:string, slot_start?:string, slot_end?:string, time_zone?:string, status?:string, gdrive_link?:string, year?:number, folder_id?:string, is_manual?:number }

+export async function lookupClientPortal(email:string, turnstileToken?:string)
+export async function searchAdminClients(q:string): Promise<{results: AdminClientRow[]}>
+export async function updateAdminDriveFolder(contactId:string, year:number, folderUrl:string)
+export async function sendAdminClientEmail(contactId:string): Promise<{success:boolean, meetingsCount?:number}>
```

Revision 2 replaces the flat row type with the grouped shape and adds the selection/notify args:

```diff
+export interface AdminClientMeeting { booking_id:string, slot_start:string, slot_end?:string,
+  meet_link?:string, purpose?:string, time_zone?:string, status?:string,
+  calendar_event_id?:string, cancel_token?:string }
+export interface AdminClient { contact_id:string, first_name:string, last_name:string, email:string,
+  phone?:string, drive_folder_url?:string, drive_folder_id?:string, drive_is_manual?:number,
+  year_folders: ClientDriveFolder[], meetings: AdminClientMeeting[] }

-export async function searchAdminClients(q, opts?): Promise<AdminClientRow[]>
+export async function searchAdminClients(q, opts?): Promise<AdminClient[]>          // reads json.clients
-export async function updateAdminDriveFolder(contactId, year: string, folderUrl)
+export async function updateAdminDriveFolder(contactId, folderUrl, year?: number)   // year omitted = client-level
-export async function sendAdminClientEmail(contactId)
+export async function sendAdminClientEmail(contactId, bookingIds?: string[])
-export async function deleteBooking(bookingId, cancelMeeting: boolean)
+export async function deleteBooking(bookingId, cancelMeeting: boolean, notifyClient?: boolean)
```

### Tests for admin endpoints

New files:
- `functions/api/admin/clients/search.test.ts`:
  - Auth mock: need to mock `isAdminAuthenticated`? In existing admin tests they mock? Check `content.test.ts` pattern.
  - Returns empty when q empty
  - Returns results filtered by email/first/last lower
  - Multiple results structure contains required fields
- `functions/api/admin/clients/drive-folder.test.ts`:
  - 400 when invalid URL
  - 404 when contact not found
  - PATCH updates is_manual=1
  - GET returns folder
- `functions/api/admin/clients/send-email.test.ts`:
  - 404 when contact_id not found
  - When future bookings exist, emailResult success and meetingsCount >0
  - When no future, still sends drive link
  - Auth required 401/403 when not admin

Frontend:
- `src/pages/AdminClients.test.tsx`:
  - Renders search input
  - Calls searchAdminClients on button click
  - Shows table rows with required columns
  - Editable input triggers updateAdminDriveFolder mock
  - Send button triggers sendAdminClientEmail

---

## 8. Navbar – `src/components/common/Nav.tsx`

### Diff

```diff
 const navItems = [
   { label: 'Services', ... },
   { label: 'About', ... },
   ...
+  { label: 'Client Portal', href: '/client-portal', show: true },
 ]

 // OR separate link next to Book button
 <div className="flex items-center gap-4 sm:gap-6 text-sm font-semibold justify-end">
+  <a href="/client-portal" className="hidden sm:inline-flex hover:underline items-center min-h-11 px-1">Client Portal</a>
   <a href="#calendar" className="inline-flex items-center min-h-11 px-4 rounded-full bg-slate-900 text-white whitespace-nowrap">Book a free call</a>
   ...

   // mobile menu includes client portal
   {menuOpen && (
     <div ...>
+      <a href="/client-portal" onClick={()=>setMenuOpen(false)} className="...">Client Portal</a>
       {sectionLinks.map(...)
     </div>
   )}
```

**Why hidden sm?** To avoid crowding mobile. Include in hamburger.

---

## 9. Other Backend – Existing Endpoints

- `functions/api/bookings/lookup.ts` – no change, but note it returns upcoming bookings. Could optionally include drive_link in response for ManageBookings? Not required but nice-to-have future.
- `functions/api/cancel/[token].ts` – ensure no drive deletion (currently doesn't). Add comment.
- `functions/_middleware.ts` – already injects TURNSTILE_SITE_KEY, covers new client-portal page (global script already in index.html).

---

## 10. Wrangler Config – `wrangler.toml`

Document vars (not secrets):
```toml
[vars]
# existing
...
# new - Drive root folder where client email folders are created. If empty, uses My Drive root.
# GOOGLE_DRIVE_ROOT_FOLDER_ID = "1a2b3c..."
```

Secrets to set via dashboard / `wrangler secret put`:
- `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY` – JSON string SA key with Drive scope, or reuse existing `GCAL_SERVICE_ACCOUNT_KEY`
- `GOOGLE_DRIVE_ROOT_FOLDER_ID` (optional var but can be secret)
- Ensure Resend key already present.

Update `.dev.vars.example` if exists.

---

## 11. Full File Change Matrix

| File | Action | Lines Changed | Risk |
|------|--------|---------------|------|
| `migrations/0014_client_drive_folders.sql` | NEW | ~25 | Low |
| `functions/_lib/env.ts` | MOD | +15 | Low |
| `functions/_lib/google-drive.ts` | NEW | ~350 | Medium – core Drive logic |
| `functions/_lib/email.ts` | MOD | +120 | Low – add templates |
| `functions/_lib/google-oauth.ts` | MOD (optional) | +20 | Low – add Drive scope support |
| `functions/api/booking/confirm/[token].ts` | MOD | +60 | Medium – main integration |
| `functions/api/client-portal/lookup.ts` | NEW | ~150 | Medium – public + Turnstile |
| `functions/api/admin/clients/search.ts` | NEW | ~180 | Medium – admin auth |
| `functions/api/admin/clients/drive-folder.ts` | NEW | ~120 | Medium |
| `functions/api/admin/clients/send-email.ts` | NEW | ~160 | Medium |
| `src/pages/ClientPortal.tsx` | NEW | ~200 | Low |
| `src/pages/AdminClients.tsx` | NEW | ~350 | Low-Med |
| `src/App.tsx` | MOD | +5 | Low |
| `src/components/common/Nav.tsx` | MOD | +10 | Low |
| `src/pages/Admin.tsx` | MOD | +2 | Low |
| `src/lib/api.ts` | MOD | +60 | Low |

### Revision 2 additions (shipped as PR-10)

| File | Action | Lines Changed | Risk |
|------|--------|---------------|------|
| `migrations/0015_client_drive_link.sql` | NEW | ~6 | Low |
| `functions/_lib/email.ts` | MOD | +130 | Low – `renderMeetingRows`, cancelled template, restore error branch |
| `functions/_lib/google-drive.ts` | MOD | +15 | Low – `opts.parentFolderId` |
| `functions/api/client-portal/lookup.ts` | MOD | +45 | Low – query meetings, always send |
| `functions/api/admin/clients/search.ts` | REWRITE | ~150 | Medium – grouped response, Drive-link match |
| `functions/api/admin/clients/drive-folder.ts` | MOD | +50 | Medium – client-level PATCH mode |
| `functions/api/admin/clients/send-email.ts` | MOD | +45 | Medium – `booking_ids` validation |
| `functions/api/admin/bookings/[id].ts` | MOD | +45 | **High – adds the missing admin auth check** |
| `functions/api/booking/confirm/[token].ts` | MOD | +8 | Low – pass `parentFolderId` |
| `functions/api/admin/bookings/manual.ts` | MOD | +8 | Low – pass `parentFolderId` |
| `src/components/admin/ClientCard.tsx` | NEW | ~180 | Low |
| `src/pages/AdminClients.tsx` | REWRITE | ~260 | Medium – grouping + selection |
| `src/lib/api.ts` | MOD | +40 | Low |

---

## 12. Tests – Coverage Plan

### Unit – Backend

1. `functions/_lib/google-drive.test.ts` (NEW) – mirrors `google-calendar.test.ts`
   - `normalizeYear` – 4-digit validation 2000-2100.
   - `extractFolderIdFromUrl` – parses drive URL.
   - `ensureClientDriveFolder` stub when local env returns fake link, source=stub.
   - search/create flow mocked fetch for Drive list/create/permission.

2. `functions/_lib/email.test.ts` – add 2 tests (drive link in confirmation, client portal multi-year).

3. `functions/_lib/env.test.ts` – add resolvers for drive root/key aliases.

4. `functions/api/client-portal/lookup.test.ts` (NEW)
   - Mock D1: contacts found + folders, contacts not found, no folders.
   - Mock Turnstile verify stub.
   - Mock fetch Resend.
   - Assert 200 generic message when not found (enumeration protection).
   - Assert email sent when found.

5. `functions/api/admin/clients/search.test.ts` (NEW)
   - Auth mock bypass.
   - Query q filters correctly (email, first, last case-insensitive).
   - Returns fields firstname, lastname, meeting time, meeting url, gdrive link, purpose, timezone.
   - Pagination limit.

6. `functions/api/admin/clients/drive-folder.test.ts` (NEW)
   - 401 when not authed.
   - 400 invalid URL, invalid year.
   - 200 PATCH updates, is_manual=1.

7. `functions/api/admin/clients/send-email.test.ts` (NEW)
   - 404 contact not found.
   - Returns meetingsCount = future only, excludes past.
   - Sends drive link even when no future meetings.

### Unit – Frontend

8. `src/pages/ClientPortal.test.tsx` (NEW)
   - Renders input, turnstile div, submit button disabled without token.
   - On submit calls lookup mock, shows success.

9. `src/pages/AdminClients.test.tsx` (NEW)
   - Renders search bar, calls search mock.
   - Table displays all required columns.
   - Editable drive link input -> calls update mock on Save.
   - Send button -> calls send mock, shows toast.

10. `src/components/common/Nav.test.tsx` (if exists, else add)
    - Contains Client Portal link href /client-portal.

### Integration – Booking Confirm

11. Extend `functions/api/booking/confirm/[token].test.ts` (NEW or extend existing?)
    - Pending booking confirm creates drive folder entry in mock D1.
    - Confirmation email HTML contains drive link.
    - When Drive API fails, booking still succeeds (non-blocking).

### Manual E2E – Checklist

- Book as new email `e2e+new@...` -> confirm:
  - D1 `client_drive_folders` row year=2026 exists.
  - Drive UI: folder `<email>` + `2026` exists, shared with client.
  - Confirmation email has drive link.
- Book same email same year -> no duplicate, reuses folder.
- Book same email next year (mock slot 2027) -> new year subfolder created, email parent same.
- Cancel booking -> drive folder still exists.
- Public `/client-portal` -> enter existing email, Turnstile pass -> receives second email with link(s).
- Public `/client-portal` -> enter unknown email -> receives generic "If exists..." but no email actually sent (or sent empty? Should log not found but return 200).
- Admin `/admin/clients` search "e2e" -> results include firstname/lastname/meeting time/meet url/gdrive link/purpose/timezone.
- Edit gdrive link in admin -> save -> DB updated is_manual=1 -> search shows new link.
- Admin Send -> client receives email with upcoming meetings list + drive link.
- Navbar: desktop shows Client Portal link, mobile hamburger includes it.

### Revision 2 – added coverage

12. `functions/_lib/email.test.ts`
    - client portal email renders upcoming meetings with a cancel link per meeting
    - client portal email renders empty states with zero folders and zero meetings
    - admin email renders only the meetings passed in (not all upcoming)
    - cancelled email contains no cancel link and no meet link, does contain the folder link
    - `sendClientPortalDriveEmail` returns `{success:false}` on a Resend non-2xx (regression guard)

13. `functions/api/client-portal/lookup.test.ts`
    - contact with meetings but zero folders still receives an email
    - only upcoming meetings appear; a past booking is excluded
    - cancel URL uses the request origin and the booking's `cancel_token`

14. `functions/api/admin/clients/search.test.ts`
    - a client with 3 year folders and 4 meetings returns 1 client and 4 meetings (fan-out regression)
    - `q` as a full Drive URL matches on `contacts.drive_folder_id`
    - `q` as a bare folder id matches on `client_drive_folders.parent_folder_id`
    - a date range with no matching meetings still returns the client with an empty meetings list

15. `functions/api/admin/clients/drive-folder.test.ts`
    - PATCH without `year` sets `contacts.drive_is_manual=1` and refreshes `parent_folder_*`
    - PATCH with `year` still upserts the year row only
    - 400 on a non-Drive URL in both modes

16. `functions/api/admin/clients/send-email.test.ts`
    - `booking_ids` omitted sends all upcoming (backward compatible)
    - `booking_ids` subset sends exactly that subset
    - 400 when a `booking_id` belongs to a different contact
    - 400 when a `booking_id` is in the past

17. `functions/api/admin/bookings/delete.test.ts`
    - **401 without admin auth** (currently unauthenticated — this test fails before the fix)
    - `notifyClient=true` sends the cancellation email; `false` does not
    - `notifyClient` defaults to the value of `cancelMeeting`
    - the delete still succeeds when the notification email throws

18. `functions/_lib/google-drive.test.ts`
    - `opts.parentFolderId` skips the email-folder search/create and creates the year folder inside it

19. `src/pages/AdminClients.test.tsx` / `src/components/admin/ClientCard.test.tsx`
    - one card per client with a single Drive input in the card header
    - header checkbox ticks all upcoming meetings; "Send selected (n)" reflects the count
    - "Send selected" is disabled at n=0 and posts the ticked `booking_ids`
    - Save posts `{contact_id, folder_url}` with no `year`
    - delete modal exposes both "cancel meeting" and "notify client" checkboxes

---

## 13. Execution Order (Day-by-Day)

**Day 1 – Foundation**
- [ ] 0014 migration
- [ ] env.ts getters + tests
- [ ] google-drive.ts with stub + JWT + tests

**Day 2 – Core Booking Integration**
- [ ] email.ts templates + tests
- [ ] booking/confirm/[token].ts integration + mock D1 upsert
- [ ] Test locally with STUB=true (fake links), then with real SA key in dev.

**Day 3 – Public Client Portal**
- [ ] functions/api/client-portal/lookup.ts + tests
- [ ] src/pages/ClientPortal.tsx + api.ts helper + tests
- [ ] App.tsx routing + Nav.tsx link

**Day 4 – Admin Portal**
- [ ] functions/api/admin/clients/search.ts
- [ ] functions/api/admin/clients/drive-folder.ts
- [ ] functions/api/admin/clients/send-email.ts
- [ ] All 3 tests
- [ ] src/pages/AdminClients.tsx + api helpers + Admin.tsx button + App routing

**Day 5 – Polish**
- [ ] Edge: ensure permission only owner+client, year 4-digit validation, Turnstile on client portal
- [ ] Manual E2E checklist, test with real Google Drive test account + Resend test email
- [ ] Documentation for secrets: how to create Drive SA key with `https://www.googleapis.com/auth/drive` scope, how to share root folder, how to get folder ID.

---

## 14. Open Questions / Decisions Needed

1. **Drive ownership**: SA owns folder vs OAuth user owns? 
   - Proposal: SA first (no re-consent), share with owner email as writer as well? Actually owner already has access if root folder owned by owner and shared? Simplest: SA creates under root that is shared with owner? Need decision. Recommend OAuth if owner wants My Drive ownership, else SA.
   - Document that if using SA, folder appears in SA's Drive, not owner's My Drive unless root folder is shared.

2. **Drive root folder**: Should it be a specific folder ID owned by admin? Recommend create folder "FanCPA Clients" in owner's Drive, share with SA as editor, put its ID as `GOOGLE_DRIVE_ROOT_FOLDER_ID`. Then all email folders under it automatically inherit owner access.

3. **Permission role**: Reader vs Writer? Spec says upload document – needs writer. So role=writer.

4. **Meet link storage**: Existing bookings have no meet_link. Migration adds column, but old bookings will have NULL. Admin UI should handle.

5. **Multiple years display**: Client portal should send all year links or only current year? Proposal: send all years links (sorted DESC) + mention year.

6. **Rate limiting client portal**: Turnstile enough? Add Cloudflare rate limiting rule on `/api/client-portal/*` in dashboard.

### Revision 2 – decided

7. **Which year does the folder use?** — **Decided: the meeting's year**, `new Date(slot_start).getFullYear()`.
   Not the current year. A booking made in Dec 2026 for a Jan 2027 slot files under `2027`.

8. **Where does "the client's Drive link" live?** — **Decided: `contacts.drive_folder_url` / `drive_folder_id`,
   1:1 with the client**, pointing at the email root folder. Year subfolders remain in
   `client_drive_folders`. The admin UI renders the client-level link once at the top of the client card.

9. **Does an admin override actually redirect new uploads?** — **Yes.** `drive_is_manual=1` makes callers
   pass `opts.parentFolderId`, so new year folders are created inside the admin's folder. Existing year
   subfolders are not moved (a Drive move is a separate, riskier operation) — they stay reachable through
   `year_folders` in the admin card and in the client portal email.

10. **Client portal email contents** — **Decided: folder link(s) + upcoming meetings + a cancel link per
    meeting**, reusing `bookings.cancel_token` and the existing `/api/cancel/[token]` endpoint. Sent
    whenever the contact exists, even with zero folders and zero meetings.

11. **Does cancelling always email the client?** — **No, it is a separate `notifyClient` flag** defaulting
    to the value of `cancelMeeting`. Deleting a mistyped test record must not email a real client.

12. **Open**: should the admin card expose "move existing year subfolders into the overridden parent"?
    Deferred — Drive `files.update` with `addParents`/`removeParents` is recoverable but noisy, and no
    concrete need has come up yet.

---

## 15. Example Diffs (Key Files)

### `src/App.tsx`
```diff
 import { Admin } from './pages/Admin'
+import { ClientPortal } from './pages/ClientPortal'
+import { AdminClients } from './pages/AdminClients'

 if (path.startsWith('/health')) return <Health />
+if (path.startsWith('/client-portal')) {
+  return <ClientPortal />
+}
+if (path.startsWith('/admin/clients')) {
+  return <AdminClients />
+}
 if (path.startsWith('/admin')) return <Admin />
```

### `src/components/common/Nav.tsx`
```diff
 const navItems = [
   { label: 'Services', href: '#services', show: visibleTypes.has('cards-grid') },
   { label: 'About', href: '#about', show: visibleTypes.has('text-block') },
   { label: 'Testimonials', href: '#testimonials', show: visibleTypes.has('testimonials') },
   { label: 'Work', href: '#work', show: visibleTypes.has('image-gallery') },
+  { label: 'Client Portal', href: '/client-portal', show: true },
 ]

 <div className="flex items-center gap-4 sm:gap-6 text-sm font-semibold justify-end">
+  <a href="/client-portal" className="hidden sm:inline-flex hover:underline items-center min-h-11 px-1">Client Portal</a>
   <a href="#calendar" className="inline-flex items-center min-h-11 px-4 rounded-full bg-slate-900 text-white whitespace-nowrap">Book a free call</a>
```

### `functions/_lib/email.ts`
```diff
 export function buildConfirmationEmail(params: {
   firstName, lastName, email, meetLink, cancelUrl, dateTime, purpose?,
+  driveLink?, driveYear?,
 }): string {
+  const driveBlock = driveLink ? `<div...><a href="${driveLink}">${driveLink}</a> Year ${driveYear}</div>` : ''
   return `...${purpose ? ...} ${driveBlock}...`
 }

+export function buildClientPortalDriveEmail({firstName, email, driveLinks}){
+  return `<div><h2>Your upload folders</h2><p>Hi ${firstName}</p>...${driveLinks.map(l=>`<a href=${l.url}>${l.year}: ${l.url}</a>`).join('')}</div>`
+}
```

### `functions/api/booking/confirm/[token].ts` (snippet)
```diff
+import { ensureClientDriveFolder } from '../../../_lib/google-drive'
 let contactId = ...
 const bookingId = ...
+let driveResult=null
+try{
+ const yr=new Date(pending.slot_start).getFullYear()
+ driveResult=await ensureClientDriveFolder(env, pending.email, yr, contactId)
+ // upsert SQL ...
+}catch(e){ console.log('!!! DRIVE_ERROR', e.message)}

-const emailResult = await sendConfirmationEmail({to:pending.email, firstName:..., meetLink, cancelUrl, dateTime, purpose, env})
+const emailResult = await sendConfirmationEmail({to:pending.email, firstName:..., meetLink, cancelUrl, dateTime, purpose, driveLink: driveResult?.yearFolderUrl, driveYear: yr, env})
```

---

## 16. Security Notes

- Turnstile on `/api/client-portal/lookup` mandatory – reuse `verifyTurnstile`.
- Generic response for not-found email to prevent enumeration.
- Admin endpoints must use `requireAdminAuth` – existing pattern in `functions/_lib/auth.ts`.
- Drive folder permissions: list existing permissions before creating to avoid duplicates.
- Validate drive URLs on admin edit: MUST match `https://drive.google.com/(drive/folders|file/d)/[A-Za-z0-9-_]+`
- No deletion on cancel – explicit comment in cancel endpoint.

### Revision 2

- **`functions/api/admin/bookings/[id].ts` currently performs no auth check.** Every other admin endpoint
  opens with `isAdminAuthenticated(request, env)`; this one does not, so `DELETE /api/admin/bookings/<id>`
  deletes any booking — and optionally wipes its calendar event — for an unauthenticated caller who can
  guess or enumerate a booking id. Fix this first in PR-10; it is the highest-severity item in the batch.
- **`booking_ids` must be validated against `contact_id`**, not just existence. Without the
  "every id is in this contact's upcoming set" check, an admin-authenticated request could forward one
  client's meeting details into another client's email.
- **Drive-link search** takes untrusted input into a lookup: match `extractFolderId(q)` / a bare id
  against `folder_id` columns with bound parameters. Never interpolate `q` into the Drive `q=` query
  string — `searchFolder` already escapes `'`, keep it that way.
- **Client-level PATCH** still validates the URL against
  `^https://drive\.google\.com/(drive/folders|file/d)/[A-Za-z0-9_-]+` before writing.

---

## 17. Rollout Steps

1. Merge migration, deploy to preview D1, run `wrangler d1 migrations apply`.
2. Set secrets in Cloudflare dashboard: `GCAL_SERVICE_ACCOUNT_KEY` already exists, add `GOOGLE_DRIVE_ROOT_FOLDER_ID` var.
3. Test in preview with `ENVIRONMENT=preview` – booking confirm creates real Drive folders in test parent folder.
4. Verify emails contain drive link (Resend dashboard).
5. Test client portal + admin portal in preview.
6. Promote to prod.

---

## 18. Future Improvements (Out of Scope)

- Auto-create index.html in Drive folder? No.
- Webhook when client uploads file? Drive push notifications.
- Show storage usage per client.
- Allow admin to delete folder (currently not required).

---
