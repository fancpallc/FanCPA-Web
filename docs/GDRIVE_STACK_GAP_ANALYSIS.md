# GDrive Stack (PR-1..PR-9) – Gap Analysis

> Audit of branches `gdrive-1 … gdrive-9` against `CLIENT_PORTAL_PR_BREAKDOWN.md` and
> `CLIENT_PORTAL_PLAN.md`. Cumulative tip audited: `725964f` (`gdrive-9`).
> Date: 2026-08-27.

> **Status Update 2026-08-28 — L6 fix**: This doc described unfixed problems at time of audit.
> Current tip (2026-08-28) has addressed:
> - **B1** NOT NULL binding — fixed in drive-folder.ts and manual.ts, now binds email+folder_id+parent ids.
> - **B2** Turnstile — fixed in lookup.ts and ClientPortal.tsx (now uses window.TURNSTILE_SITE_KEY, retry, expired-callback, local/test bypass).
> - **B3** DELETE auth — fixed, isAdminAuthenticated added to [id].ts.
> - **H1** searchFolder encoding — fixed (escapes ', encodes whole q, adds fields).
> - **H2** null guards — fixed.
> - **H3** stub discard — fixed, live env now throws on missing token instead of fabricating fake folder.
> - **H4** ensurePermission — wrapped in try/catch, skips owner, checks result, now also shares parent when parentFolderId override used (L4).
> - **H5** env getters — fixed, calls getDriveRootFolderId / getEffectiveDriveRootFolderId (which now tries admin_settings + settings with correct quotes).
> - **M1–M10, F1–F5** covered by PR-10 implementation.
> - **C1** fake URL persistence — fixed: getDriveAccessToken returns error, ensureClientDriveFolder throws in live env, manual.ts and confirm/[token].ts return 502 on stub source, never persist fake- ids.
> - **C2** docker-compose pipefail inert — fixed via YAML literal block `|`.
> - **C3** lint red — fixed AdminClients.test.tsx checked cast to HTMLInputElement.
> - **H1** /file/d/ accepted as folder — fixed, only /drive/folders/ accepted.
> - **H2** browserTz UTC — fixed, defaults to America/New_York, ignores Worker's UTC.
> - **H3** timeout — fetchJson default 5000→8000, admin fan-out calls 15000/20000.
> - **M1** sentinel href — fixed, driveLink null not "No folder...", email templates guard https:// only.
> - **M2** gdrive-constraint.test.ts mock-only — added real SQLite test via node:sqlite.
> - **M3** global console suppression — narrowed to patch all methods but only !!! prefix (plus noisy React `was not wrapped in act` on console.error per-method), documented that real errors must not use !!!.
> - **M4** upcomingCount unused — removed.
> - **L1** brittle startsWith('http') overload — removed.
> - **L2** isUpcomingConfirmed clock skew — added 60s grace.
> - **L3** cancel email before DELETE — reordered DELETE before email.
> - **L5** HTML injection — added escapeHtml for purpose/firstName/dateTime.
> Remaining open: docs/SETUP_DRIVE.md still minimal — see README for env setup.

## Method

- Audited the **cumulative tip**, not each branch in isolation — `gdrive-9` contains everything.
- Ran `npm run lint`, `npm run test:workers -- --run`, `npm test -- --run` on the tip.
- Replayed every `client_drive_folders` write against a real SQLite database built from
  `migrations/0014_client_drive_folders.sql`, because the unit tests mock D1 and mocks do not
  enforce constraints.

## Verification status

| Check | Result |
|---|---|
| `npm run lint` (`tsc --noEmit`) | ✅ clean |
| `npm test -- --run` (frontend) | ✅ 89 passed / 22 files |
| `npm run test:workers -- --run` | ⚠️ **231 passed, 3 failed** |

The 3 failures are all in `functions/_lib/google-calendar.test.ts` (`filterWorkingDays`, the two
`minNoticeDays` day-window tests). That file is **byte-identical to `main`** — these are pre-existing
local-timezone-dependent assertions, not stack regressions. They still matter: PR-9's acceptance is
"`docker compose run --rm tests` → green", and it is not green.

## Stack state

`gdrive-6` (`4e5bd3a`) is the last local branch contained in `gdrive-9`'s history. Local
`gdrive-1`, `-2`, `-4`, `-5`, `-6` have all diverged from their `origin/*` counterparts (rebased or
amended by the "address comments" passes) and no longer sit on `gdrive-9`'s line. Only `gdrive-3` and
`gdrive-9` are in sync with origin. Before opening PR-10, force-push the rebased tips or delete the
stale local branches — reviewing `origin/gdrive-2` today does not show what actually shipped.

---

## Blockers — shipped features that cannot work against a real database

### B1. Every `client_drive_folders` write outside `booking/confirm` violates NOT NULL

`migrations/0014_client_drive_folders.sql` declares `email TEXT NOT NULL` and `folder_id TEXT NOT NULL`.
Two of the three writers omit them.

**`functions/api/admin/clients/drive-folder.ts:44`** — omits `email`:

```sql
INSERT INTO client_drive_folders (contact_id, year, folder_url, folder_id, is_manual)
VALUES (?, ?, ?, ?, 1)
ON CONFLICT(contact_id, year) DO UPDATE SET ...
```

**`functions/api/admin/bookings/manual.ts:57`** — omits `email` *and* `folder_id`:

```sql
INSERT OR REPLACE INTO client_drive_folders (contact_id, folder_url, year) VALUES (?, ?, ?)
```

Replayed against real SQLite:

```
drive-folder.ts PATCH  -> Error: NOT NULL constraint failed: client_drive_folders.email (19)
manual.ts INSERT       -> Error: NOT NULL constraint failed: client_drive_folders.email (19)
```

The `ON CONFLICT … DO UPDATE` does **not** rescue it: SQLite evaluates NOT NULL before conflict
resolution, so the PATCH fails even when the target row already exists (verified).

Impact:
- **"Admin can update the gdrive link" is broken 100% of the time** — `PATCH /api/admin/clients/drive-folder`
  always 500s.
- **"Admin can add a meeting" is broken on its default path** — `POST /api/admin/bookings/manual` 500s
  whenever `drive_folder_url` is not supplied by the caller, which is the documented behaviour
  ("gdrive link auto generated"). It fails *after* upserting the contact and *before* inserting the
  booking, leaving a contact row with no booking and no calendar event.

`booking/confirm/[token].ts:186` is the only correct writer — it binds all seven columns.

Why the tests are green: `drive-folder.test.ts` and `manual.test.ts` mock D1 with plain objects, so no
constraint is ever evaluated. Any fix needs at least one test that runs the statement against real
SQLite (or `wrangler d1 execute --local`).

### B2. Client portal Turnstile never verifies, and the widget never renders

**Backend — `functions/api/client-portal/lookup.ts:6`**

```ts
const isTurnstileValid = await verifyTurnstile(turnstileToken, env.TURNSTILE_SECRET);
```

Two problems. The configured secret is `TURNSTILE_SECRET_KEY` (see `.dev.vars.example:10`,
`wrangler.toml`, and every other caller), so `env.TURNSTILE_SECRET` is `undefined`. And the third
`env` argument is not passed, so `verifyTurnstile` cannot fall back to `getTurnstileSecret(env)`
(`functions/_lib/turnstile.ts:23`) and cannot see `ENVIRONMENT`. Execution reaches the
"secret missing → fail open" branch (`turnstile.ts:36-40`) and returns `{ok: true, source: 'stub'}`
**in production**.

Compare the working callers: `functions/api/booking.ts:89` and `functions/api/bookings/lookup.ts:51`
both use `getTurnstileSecret(env) || env?.TURNSTILE_SECRET_KEY`.

Net effect: the one public, unauthenticated endpoint that sends email to an arbitrary address has no
bot protection. Plan §16 lists Turnstile here as mandatory.

**Frontend — `src/pages/ClientPortal.tsx:20`**

```ts
sitekey: import.meta.env.VITE_TURNSTILE_SITE_KEY,
```

The app's convention is `window.TURNSTILE_SITE_KEY`, injected server-side by
`functions/_middleware.ts:23` so the key can rotate without a rebuild (`BookingForm.tsx:46` uses it).
`VITE_TURNSTILE_SITE_KEY` is set nowhere, so `sitekey` is `undefined`, the widget fails to render,
`turnstileToken` stays `null`, and the submit button is `disabled` forever.

Compounding it: the render runs in a single mount effect guarded by `if (window.turnstile)`. The
Turnstile script is loaded `async defer` (`index.html:8`), so on a cold load it is usually not ready at
mount and the effect no-ops. `BookingForm.tsx` has retry logic and a local/test bypass
(`setTurnstileToken('fake-token-for-test')`); neither was copied. There is also no `expired-callback`,
which Plan §6 explicitly listed — tokens expire after ~5 minutes and submit then sends a stale one.

**`/client-portal` is non-functional in production.** `ClientPortal.test.tsx` passes because it mocks
`window.turnstile`.

### B3. `DELETE /api/admin/bookings/:id` has no authentication

`functions/api/admin/bookings/[id].ts:4` — `onRequestDelete` never calls `isAdminAuthenticated`.
Every other admin endpoint opens with it (`clients/search.ts`, `clients/drive-folder.ts`,
`clients/send-email.ts`, `bookings/manual.ts:7`).

Any unauthenticated caller who can guess or enumerate a booking id can delete the booking and, with
`?cancelMeeting=true`, delete its Google Calendar events.

Already written up as the first item of PR-10.

---

## High — live Drive path is broken or crashes

All in `functions/_lib/google-drive.ts`. None of it is exercised by the tests, which only cover the
stub path and the pure helpers.

### H1. `searchFolder` can never match a folder that `createFolder` created (line 26)

```ts
const q = `mimeType='...folder' and name='${encodeURIComponent(name)}' and '${parentId}' in parents ...`
const response = await fetch(`https://www.googleapis.com/drive/v3/files?q=${q}`, ...)
```

`encodeURIComponent` is applied to the name **inside the quoted literal**, so the query asks Drive for a
folder literally named `john%40abc.com`, while `createFolder` (line 48) creates `john@abc.com`. The
lookup never matches.

Then `q` itself is interpolated into the URL **unencoded**, so the spaces and `'` in the query string
are not escaped either.

Consequence: **"if the client already existed we will not recreate" does not hold.** Every booking
creates a fresh duplicate `john@abc.com` folder under the root, and a fresh year folder under it.

This is a regression inside the stack — the `gdrive-2` version encoded the whole `q` and escaped `'`:

```ts
const escaped = name.replace(/'/g, "\\'")
const q = `... name='${escaped}' ...`
fetch(`...?q=${encodeURIComponent(q)}&fields=files(id,name)`, ...)
```

The `&fields=files(id,name)` projection was dropped too.

### H2. Null-folder crash (lines 121, 127)

`createFolder` returns `null` on a non-2xx (line 53). Lines 121 and 127 dereference `emailFolder.id` /
`yearFolder.id` with no guard → `TypeError: Cannot read properties of null`. `gdrive-2` had
`if (!emailFolder || !emailFolder.id) throw new Error('Failed to ensure email folder')`; the guards were
removed later in the stack.

`booking/confirm` catches it (non-blocking, as designed). `manual.ts` does not — it 500s.

### H3. Missing credentials produce a bogus live call instead of a stub (lines 95, 111-115)

`getDriveAccessToken` returns `{token: '', source: 'stub'}` when `hasOAuthConfig(env)` is false
(line 18), but line 111 destructures only `token` and **discards `source`**. Execution continues into
the live path and calls Drive with `Authorization: Bearer ` → 401 → `searchFolder` null →
`createFolder` null → the H2 crash. The returned object still claims `source: 'live'`.

`gdrive-2` had the early return:

```ts
const { token, source } = await getDriveAccessToken(env)
if (source === 'stub') return { ...stubResult, source: 'stub' }
```

Related: the stub gate at line 95 only checks `STUB` / `ENVIRONMENT`. Plan §2 step 3 and PR-2's prompt
both specify "local/test **or STUB or missing key**". Add the credential check back.

### H4. `ensurePermission` is unguarded and never skips the owner (lines 60-82)

- No `try/catch`. A 403 (folder not owned by the OAuth user) or a non-JSON body makes `response.json()`
  throw and takes down the whole `ensureClientDriveFolder` call.
- No owner skip. Plan §2 and PR-2 both specify "skip if email == owner admin email"; `getDriveOwnerEmail`
  (`env.ts`) is therefore dead code — sharing a folder with its own owner is an API error.
- The POST result is not checked, so a failed share is silent and the client gets a link they cannot open.

### H5. Env alias helpers are dead; the documented aliases do not work

`google-drive.ts:115` reads `env?.GOOGLE_DRIVE_ROOT_FOLDER_ID` directly instead of calling
`getDriveRootFolderId(env)`. The `DRIVE_ROOT_FOLDER_ID` / `GDRIVE_ROOT_FOLDER_ID` aliases that PR-1 added
and tested therefore have no effect at runtime.

Never called anywhere in production code: `getDriveRootFolderId`, `getDriveServiceKey`,
`getDriveOwnerEmail`, `getDriveFolderId`, `getEffectiveDriveRootFolderId`.

`getEffectiveDriveRootFolderId` (`env.ts:161`) is also broken on its own terms:

```ts
await db.prepare('SELECT value FROM settings WHERE key = "drive_root_folder_id"').first()
```

Two bugs — the table is `admin_settings` in the plan and neither `settings` nor `admin_settings` exists
in any migration, and `"drive_root_folder_id"` is double-quoted, which SQLite parses as an *identifier*,
not a string literal. Both errors are swallowed by the bare `catch {}`, so it silently always falls
through to the env var. Either implement it with a real table and single quotes, or delete it.

### H6. SA fallback advertised but never implemented (lines 12-19)

PR-2 specifies "fallback SA JWT scope `https://www.googleapis.com/auth/drive`". The body is a comment.
The stack settled on OAuth Option B, which is a fine decision — but `.dev.vars.example`, the
`DRIVE_KEY_ALIASES` in `env.ts`, and Plan §2/§10 still advertise `GOOGLE_DRIVE_SERVICE_ACCOUNT_KEY`.
Either implement it or strip it from the docs and env helpers so nobody configures a key that does
nothing.

---

## Medium — correctness and requirement gaps

### M1. Admin search fans out one meeting per year folder

`functions/api/admin/clients/search.ts:37`:

```sql
LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id
```

No year correlation. A client with 3 year folders and 4 meetings returns 12 rows — every meeting
duplicated once per folder. Plan §7's original SQL had
`AND CAST(strftime('%Y', b.slot_start) AS INTEGER) = cdf.year`; it was dropped in implementation.

Covered by PR-10's grouped rewrite.

### M2. Date filter silently drops clients

Also `search.ts` — `AND datetime(b.slot_start) >= datetime(?)` applies to a `LEFT JOIN`ed table, which
turns it into an inner join. A matched client whose meetings all fall outside the range disappears
entirely instead of returning with an empty meetings list. Covered by PR-10.

### M3. Per-row Drive input is keyed by `contact_id`, writes to a guessed year

`src/pages/AdminClients.tsx:192-196`. `editing[r.contact_id]` is shared across every row for that
client, so typing in one row visually rewrites all of them. And
`handleSave(r.contact_id, r.year || new Date().getFullYear())` falls back to the *current* year whenever
`r.year` is undefined (which is always, for a client with no folder yet) — writing the link to the wrong
year row. Covered by PR-10's client-level link.

### M4. `manual.ts` drops `time_zone` and `phone`

`functions/api/admin/bookings/manual.ts:15` destructures neither, and the `INSERT INTO bookings` at
line 71 has no `time_zone` column. `AdminClients.tsx:118` collects a phone number that the backend then
discards. PR-7's prompt also specified a `time_zone` field defaulting to the browser zone — it is absent
from both the modal and the endpoint. Admin-created bookings therefore show a blank Timezone column and
render their times in the server's zone, while `datetime-local` inputs are read as local time and sent as
UTC with no record of which zone they came from.

### M5. `manual.ts` confirmation email has no cancel link and an unformatted date

Line 85: `dateTime: slot_start` passes a raw ISO string where every other caller passes a
`toLocaleString`-formatted value (`confirm/[token].ts:214`). And `cancelUrl` is never passed, even
though `cancelToken` was generated at line 62 and stored — so a client added by the admin receives a
confirmation email with **no way to cancel**, unlike a self-service booking. `driveYear` is also omitted.

### M6. `manual.ts` has no failure isolation

PR-3 deliberately wrapped the Drive call in try/catch so a Drive outage cannot break a booking.
`manual.ts` wraps neither the Drive call (line 55) nor the calendar call (line 63). Either one throwing
500s the request after the contact has already been upserted. There is also no slot-conflict check, so
the admin can double-book a slot the public calendar shows as taken.

### M7. Resend errors are reported as success

`sendClientPortalDriveEmail` and `sendAdminDriveEmail` (`functions/_lib/email.ts`) lost their
`if (!res.ok)` branch and all their `!!! *_EMAIL_*` logs during the PR-2 "address comments" pass. A
Resend 4xx/5xx now falls through to `return { success: true, id: json.id, source: 'live' }`. The admin
UI toasts "Email sent" for mail that was rejected. `sendConfirmationEmail` still has the branch —
restore to match. Covered by PR-10.

### M8. `send-email.ts` returns less than its contract

Plan §7 specifies `{success, sentTo, meetingsCount, driveLink, emailResult}`; the implementation returns
`{success: true}` only, and never logs `!!! ADMIN_CLIENT_SEND`. It also ignores the `sendAdminDriveEmail`
result entirely, so combined with M7 a failure is invisible twice over.

### M9. `lookup.ts` has no input validation

`functions/api/client-portal/lookup.ts` — no `try/catch` around `request.json()`, and no check that
`email` is present or well-formed before `email.toLowerCase()`. A malformed body or a missing `email`
throws and returns an unhandled 500 from a public endpoint. Every other public endpoint validates first.

### M10. Confirm-flow upsert does not refresh folder ids

`booking/confirm/[token].ts:186` — `ON CONFLICT(contact_id, year) DO UPDATE SET folder_url=excluded.folder_url,
updated_at=datetime('now')`. If a folder is recreated (see H1) or repointed, `folder_id`,
`parent_folder_id` and `parent_folder_url` keep their stale values while `folder_url` moves on. Plan §5's
version updated all four.

---

## Low — hygiene

- **L1.** `src/pages/AdminClients.tsx:5` imports `Link` from `react-router-dom` and never uses it. The
  app routes by `path.startsWith(...)` in `src/App.tsx`; `react-router-dom@^7` was added to
  `dependencies` for this dead import. Remove both.
- **L2.** `vitest` jumped `^2.1.8 → ^4.1.11` inside PR-2, unrelated to that PR's scope, and dragged
  ~1600 lines of `package-lock.json` with it. `vite.config.ts` needed a `// @ts-ignore` above the `test`
  key to survive it. Worth calling out in the PR-2 description or reverting.
- **L3.** `@testing-library/user-event` sits in `dependencies` instead of `devDependencies` — it ships
  to the browser bundle.
- **L4.** `google-oauth.ts:73-76` — the `catch` block's indentation was mangled during the PR-2 pass.
- **L5.** Indentation inside `searchFolder` / `createFolder` / `ensureClientDriveFolder` in
  `google-drive.ts` is inconsistent (bodies not indented under their `try`). Cosmetic, but it is how H2's
  missing guards went unnoticed.
- **L6.** `ClientPortal.tsx` renders bare, without the `Layout` wrapper. Plan §6 called for Layout so the
  page keeps the site nav and footer. The Nav link to it exists (`Nav.tsx:24`), so users land on a page
  with no way back.
- **L7.** PR-9 item 3 ("`README.md` or `docs/SETUP_DRIVE.md` — Drive setup Option B, steps 1-5") was never
  written. `README.md` has no Drive section and `docs/` contains only the two planning docs. The OAuth
  consent / root-folder-sharing procedure exists nowhere in the repo.
- **L8.** Stub mode cannot represent folder reuse: `google-drive.ts:99` builds the *email* folder id as
  `fake-${safeEmail}-${year}`, so it changes per year. PR-3's manual check "same email next year → new
  year subfolder, email parent same" passes vacuously in stub mode. Drop `-${year}` from the parent id.

---

## Missing — specified but never built

Distinct from the sections above: those are defects in code that shipped. These are behaviours the
product intent calls for that have no implementation at all. All five are the scope of **PR-10b**
(`CLIENT_PORTAL_PR_BREAKDOWN.md` § PR-10).

Two things worth separating out first, because they were missing from `CLIENT_PORTAL_PLAN.md` and are
easy to misfile here: **admin add meeting** and **admin cancel meeting** *were* built, in PR-7 and PR-8.
They were absent from the plan doc, not from the code. The plan has since been updated (§7 "Backend Add
Record" / "Backend Delete/Cancel"). Their defects are B1, B3 and M4-M6, not this section.

### F1. Client portal email carries no meetings and no cancel links

`functions/_lib/email.ts:207` — `buildClientPortalDriveEmail({firstName, driveLinks})` renders folder
links only. `functions/api/client-portal/lookup.ts` never queries `bookings`, so the email a client gets
after entering their address has no meeting list and no way to cancel.

Intent: the email should list upcoming meetings (time in the client's zone, purpose, join link) with a
cancel link per meeting, alongside the Drive link. `bookings.cancel_token` and `/api/cancel/[token]`
already exist — no new cancellation surface is needed.

Related, and why this is worse than it looks: `lookup.ts:28` gates sending on
`if (driveLinks.results.length)`. A client with meetings but no folder yet receives **nothing at all** —
not even the generic acknowledgement the UI promises them.

### F2. No per-meeting selection for forwarding

`functions/api/admin/clients/send-email.ts:9` accepts `{contact_id}` only and forwards *every* upcoming
confirmed booking. `src/pages/AdminClients.tsx` has no checkbox column — the only two checkboxes in the
file are "Send Confirmation Email" on the add modal (line 122) and "Also cancel meeting" on the delete
modal (line 139).

Intent: a checkbox per meeting row plus a select-all in the client header, and
`POST send-email {contact_id, booking_ids}` sending exactly the ticked set. Note the validation
requirement — every `booking_id` must belong to that `contact_id` and be upcoming, or one client's
meeting details can be forwarded into another client's inbox.

### F3. Cancelling a meeting does not notify the client

`functions/api/admin/bookings/[id].ts` deletes the booking and optionally the calendar events, and sends
no email. There is no `buildBookingCancelledEmail` / `sendBookingCancelledEmail` in
`functions/_lib/email.ts`. A client whose meeting the admin cancels finds out when the calendar
invite vanishes.

Intent: a cancellation email behind a `notifyClient` flag defaulting to the value of `cancelMeeting`,
non-blocking so a Resend failure cannot abort the delete. The flag is separate on purpose — deleting a
mistyped test record must not email a real person.

The add side is partially covered: `manual.ts` has a `sendEmail` flag, but see M5 — that email has no
cancel link and an unformatted date.

### F4. The Drive link is neither client-level nor at the top

`src/pages/AdminClients.tsx:190-197` renders an editable Drive input **inside every meeting row**, bound
to `client_drive_folders` per year. The link is 1:1 with the client's email, so it belongs once in a
client header. Today there is no client-level storage for it either — `contacts.drive_folder_url` is
written by `booking/confirm` but nothing reads it.

Intent: migration `0015`, one link per client card, `PATCH {contact_id, folder_url}` with no `year`.
Carries M1 (search fan-out) and M3 (shared `editing[contact_id]` state, guessed year) with it.

### F5. Admin cannot look up a client by Drive link

`functions/api/admin/clients/search.ts:41-47` matches `q` against `email`, `first_name`, `last_name`
only. Given a Drive folder URL there is no way to find out whose it is.

Intent: detect a Drive URL or bare folder id in `q` via `extractFolderId` (already exported from
`google-drive.ts:21`) and match `contacts.drive_folder_id`, `client_drive_folders.folder_id`,
`client_drive_folders.parent_folder_id`. Needs the two indexes added in migration `0015`.

---

## Per-PR coverage

| PR | Branch | Delivered | Gaps |
|----|--------|-----------|------|
| PR-1 DB + env + email | gdrive-1 | ✅ migration 0014, env getters + tests, email templates | H5 (getters never called; `getEffectiveDriveRootFolderId` broken) |
| PR-2 Drive core lib | gdrive-2 | ⚠️ stub path + helpers only | **H1, H2, H3, H4, H6**, L2, L5, L8 — the live path does not work |
| PR-3 Confirm integration | gdrive-3 | ✅ best-implemented slice: correct 7-column upsert, non-blocking, drive link in email | M10 |
| PR-4 Public client portal | gdrive-4 | ⚠️ endpoint + page + route + Nav link exist | **B2** (unusable in prod), M9, L6, **F1** |
| PR-5 Admin backend | gdrive-5 | ⚠️ 3 endpoints, all authed | **B1** (drive-folder), M1, M2, M8, **F2, F5** |
| PR-6 Admin UI + time filter | gdrive-6 | ✅ search, filter, table, send, admin entry link | M3, L1, **F2, F4** |
| PR-7 Admin add record | gdrive-7 | ⚠️ endpoint + modal, authed | **B1** (manual), M4, M5, M6 |
| PR-8 Admin delete + cancel | gdrive-8 | ⚠️ endpoint + modal | **B3** (no auth), **F3** |
| PR-9 Polish + docs | gdrive-9 | ⚠️ `.dev.vars.example`, `wrangler.toml` comment | L7 (no setup doc); acceptance "tests green" not met (3 pre-existing failures) |

## Requirement coverage

| Requirement | State |
|---|---|
| Create GDrive on booking | ⚠️ works in stub; live path broken (H1-H4) |
| Detect existing client by email, do not recreate | ❌ H1 — duplicates every time |
| Year subfolder, keyed on the meeting's year | ✅ |
| Client enters email → receives email | ❌ B2 — form cannot be submitted |
| That email lists upcoming meetings + cancel links | ❌ **F1** — not built |
| Admin looks up client | ⚠️ by email/name only; by Drive link is **F5** |
| One row per meeting | ⚠️ M1 fan-out |
| GDrive link at the top, 1:1 with client | ❌ **F4** — per-row today |
| Checkboxes to pick meetings to forward | ❌ **F2** — not built |
| Admin updates the GDrive link | ❌ **B1 — always 500s** |
| Admin cancels a meeting | ⚠️ works, but **B3 unauthenticated** |
| Admin adds a meeting | ❌ **B1 — 500s on the default path** |
| Email on add | ⚠️ sends, but no cancel link, unformatted date (M5) |
| Email on cancel | ❌ **F3** — not built |

## Recommended sequencing

PR-10 as written covers F1-F5 plus M1, M2, M3, M7 and B3. It does **not** cover the remaining blockers
or the live-Drive breakage, and those are more urgent — three shipped features currently 500 or silently
no-op against real infrastructure. Building F1-F5 on top of a Drive layer that duplicates folders (H1)
and a `client_drive_folders` table nothing can write to (B1) would just add features that fail the same way.

Suggested split:

**PR-10a — make what shipped actually work** (do this before PR-10's feature work):
- B1: bind `email`, `folder_id`, `parent_folder_id`, `parent_folder_url` in `drive-folder.ts` and
  `manual.ts`; add one test that runs the statement against real SQLite.
- B2: `verifyTurnstile(token, getTurnstileSecret(env) || '', env)` in `lookup.ts`;
  `window.TURNSTILE_SITE_KEY` + retry + `expired-callback` + local/test bypass in `ClientPortal.tsx`.
- B3: add `isAdminAuthenticated` to `[id].ts`.
- H1-H4: restore the `gdrive-2` `searchFolder` encoding, the null guards, the `source === 'stub'` early
  return, and the credential check in the stub gate; wrap `ensurePermission` and add the owner skip.
- H5: call `getDriveRootFolderId(env)`; fix or delete `getEffectiveDriveRootFolderId`.

**PR-10b — the Rev 2 feature work**, i.e. F1-F5, already specified in
`CLIENT_PORTAL_PR_BREAKDOWN.md` § PR-10.

**PR-10c — cleanup**: M4, M5, M6, M8, M9, M10, and the L items (including L7's setup doc).
