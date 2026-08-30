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

---

# Rev 3 — requested copy / UX changes, verified 2026-08-29

Each item below was checked against the working tree at `9959f64`. "Verdict" says whether the change is
valid as asked, already done, or constrained by something outside our control.

| # | Ask | Verdict | Anchor |
|---|---|---|---|
| R1 | "check your spam" on booking-requested | ✅ valid — but the panel you see is **Home.tsx**, not the one that already has the line | `src/pages/Home.tsx:182-197` |
| R2 | "cancel anytime" → "cancel 24 hours prior" | ⚠️ valid copy change, but the backend has **no 24h cutoff** — copy would be false | `functions/api/booking/confirm/[token].ts:332` |
| R3 | Drive link on the confirm page | ✅ valid — the link exists in the email, never on the page | `functions/api/booking/confirm/[token].ts:324-363` |
| R4 | Calendar invite says "unknown sender" | ⚠️ partly — organizer name is fixable (calendar `summary`), the banner is Gmail-side | `functions/_lib/google-oauth.ts:110-126` |
| R5 | Invite time in the client's timezone | ⚠️ valid and cheap — we already store the zone and throw it away; exact effect on the Google subject line needs one live test | `google-oauth.ts:113-114`, `google-calendar.ts:642-643` |
| R6 | "Clients" → "Client Portal" in admin | ✅ valid, one word | `src/pages/Admin.tsx:255` |
| R7 | Drive usage next to storage check | ✅ valid — R2 only today | `functions/api/admin/r2-usage.ts`, `src/pages/Admin.tsx:251-270` |
| R8a | Edit-Drive-link button | ⚠️ saving already works; the ask is a view/edit toggle | `src/pages/AdminClients.tsx:793-838` |
| R8b | Add-Drive-link button when none | ⚠️ already functional via the same input; affordance only | same |
| R9 | Hyperlink the Drive link when not editing | ✅ valid — client-level link is never clickable | same |
| R10 | Icons in the Actions column | ✅ valid — text "Delete" only, no per-row send | `src/pages/AdminClients.tsx:900-917`, `946-960` |
| R11 | Drop "Also" from the cancel checkbox | ✅ valid, one label | `src/pages/AdminClients.tsx:664` |
| R12 | Show phone / first / last on the client portal | ✅ **already done** on the admin card; ❌ missing from the public portal email | `AdminClients.tsx:757-762`; `functions/_lib/email.ts:245-279` |
| R13 | Admin edits first/last name | ⚠️ writable today only as a side effect of Add Booking | `functions/api/admin/bookings/manual.ts:98-110` |
| R14 | Expand/collapse long purpose | ✅ valid — purpose is unbounded and untruncated | `AdminClients.tsx:888`, `functions/api/booking.ts:66` |

---

### R1. "Please check your spam folder" on the booking-requested panel

Valid, **but the file to change is not the obvious one**, and finding out why turned up a live bug.

`functions/api/booking.ts:288-305` returns `{status: 'pending_confirmation', message, emailResult}`. It
never returns `pending: true`. `BookingForm.tsx:188` branches on `if ((result as any).pending)` — always
false. So the double-opt-in panel at `BookingForm.tsx:256-290` — the one titled "Check your email 📧",
carrying the confirm-link fallback, the email-failure warning, **and the existing
"No email yet? Check your spam folder." at line 281** — is dead code and has never rendered.

Execution falls through to `setSuccess(...)` + `onSuccess(...)` at `BookingForm.tsx:200-220`, with
`result.meetLink` / `result.dateTime` / `result.cancelUrl` all `undefined` (the 202 body has none of
them). `Home.tsx:153` renders `{selectedSlot && !bookingResult && <BookingForm/>}`, so the moment
`onSuccess` sets `bookingResult` the form unmounts and its own green "Booking Requested" panel
(`BookingForm.tsx:308-320`) never paints either.

**The panel the visitor actually sees is `src/pages/Home.tsx:182-197`** — the amber one. Its copy is
already correct about the confirm step ("please check … inbox to confirm this appointment"); it just
lacks the spam line.

Two things to decide, and they are separable:
- **The copy** — add the spam sentence to `Home.tsx:193-196`. One line, no risk.
- **The dead panel** — either set `pending: true` in the 202 body so the richer panel (spam line,
  confirm-link fallback, email-failure warning) starts working, or delete
  `BookingForm.tsx:256-320` and its `pending`/`success` state. Right now the confirm-link escape hatch
  for "Resend rejected the mail" is unreachable, which is the part that costs a booking. Recommend
  fixing the flag rather than deleting.

Worth also adding the line to the pending email body itself (`functions/_lib/email.ts:117-131`) — no,
skip that: a reader of that email is by definition not in the spam folder.

### R2. "Cancel anytime" → "cancel 24 hours prior"

The string is at `functions/api/booking/confirm/[token].ts:332`:

```html
<p …>Cancel anytime: <a href="${cancelUrl}">${cancelUrl}</a></p>
```

It is the only occurrence — `grep -rni "anytime" src functions` returns this line and nothing else. The
confirmation *email* (`email.ts:100`) says only "Cancel link:", so it needs no change unless you want
the policy stated there too (recommended — the email outlives the page).

**The blocker is that the policy does not exist.** `functions/api/cancel/[token].ts` looks up the booking
by token and deletes it; there is no comparison of `slot_start` against `now` anywhere in the file (the
only `Date.now()` at line 65 is the JWT `iat`). A client can cancel ten minutes before the meeting and
the endpoint will happily free the slot. `functions/api/bookings/lookup.ts:115` filters the *list* to
upcoming meetings but applies no notice window either.

So this is two changes, not one:
1. Enforce the window in `cancel/[token].ts` — reject with a "too late to cancel online, reply to this
   email" page when `slot_start - now < 24h`.
2. Then change the copy at `[token].ts:332` (and, ideally, `email.ts:100`).

Shipping (2) without (1) puts a rule on the page that the software does not implement — worse than the
current honest "anytime". Flagging so you can pick; if you only want the copy, say so and it ships alone.

### R3. Drive link on the confirm page

Valid and easy. The confirm page HTML (`booking/confirm/[token].ts:324-363`) renders date, purpose, Meet
link, cancel link and an .ics button — no Drive link. The link is only in the email
(`sendConfirmationEmail(… driveFolderUrl: driveLink …)` at line 293).

`driveLink` is already in scope at the render site: declared at line 167, assigned at line 206 from
`driveResult.yearFolderUrl`. So the block is a conditional paragraph next to the Meet link.

Two guards it needs, both learned from M1/C1:
- `driveLink` is `null` whenever Drive failed — the flow is deliberately non-blocking
  (lines 198-244), so a Drive outage still confirms the booking. Render nothing rather than an empty
  `href`, matching `email.ts:257` which gates on `startsWith('https://')`.
- The year is `meetingYear` (line 167), so the label can read "Upload your documents for 2026".

Suggested copy, since the ask is specifically to prompt an upload: *"Upload your documents here:
&lt;link&gt; — anything you add to this folder is visible to us before the meeting."*

### R4. Calendar invite organizer — "Invitation from an unknown sender"

Partly fixable; the specific string is not ours.

"Invitation from an unknown sender" is a **Gmail-side warning banner**, rendered by the recipient's
Gmail above an event card when the organizer's address is not in their contacts and they have no prior
correspondence. It is not the subject line, not a field in the Calendar API, and not something the
sender can suppress. Google composes the subject itself as `Invitation: <summary> @ <when> (<email>)`;
the `<summary>` half is already ours — `Meeting with ${firstName} ${lastName}`
(`google-oauth.ts:111`, `google-calendar.ts:640`).

What *is* controllable is the **organizer display name**, which is what the ask is really after:

- The `organizer` field on the Event resource is read-only for `events.insert` — it cannot be set in
  the payload at `google-oauth.ts:110-126`.
- `BOOKING_CALENDAR_ID` is a secondary calendar (see the `forbiddenForServiceAccounts` /
  "group calendar" handling at `google-calendar.ts:686-703`). For a secondary calendar, Google shows
  the **calendar's `summary`** as the organizer. Renaming that calendar — Calendar UI, or
  `PATCH /calendar/v3/calendars/{id}` with `{"summary": "FanCPA"}` — changes what recipients see from
  the raw calendar name to the business name.
- The underlying Google account's name (currently the `metagtmtest1@gmail.com` test account per the
  comment at `google-oauth.ts:108`) is the other half. Changing it is an account setting, not code.

Net: a one-time config change gets you a named organizer. The "unknown sender" banner will still appear
for recipients who have never corresponded with that address, and disappears on its own once they have.
No code change in this repo.

### R5. Invite time rendered in the client's timezone

Valid, cheap, and it exposes a small data-loss bug — but the exact effect on the Google-generated
subject line should be confirmed with one live send before it is called done.

We already collect and store the client's zone: `booking.ts:260` writes `time_zone` into
`pending_bookings` (migration `0011`), and `confirm/[token].ts:249` carries it onto `bookings`. It is
used to format *our* Resend email (`confirm/[token].ts:271`, `manual.ts:7-22`).

It is **not** passed to Google. `CreateEventParams` (`google-calendar.ts:381-390`) has no timezone field,
so both writers hardcode the office zone:

```ts
start: { dateTime: params.slot.start, timeZone: env?.TIMEZONE || TIMEZONE },  // google-oauth.ts:113
start: { dateTime: params.slot.start, timeZone: TIMEZONE },                   // google-calendar.ts:642
```

`TIMEZONE` is `'America/New_York'` (`google-calendar.ts:93`). A Pacific-coast client gets an invite whose
event timezone is Eastern.

Safe to change: `slot.start` / `slot.end` are UTC ISO strings ending in `Z`, so the instant is fully
determined by `dateTime` and `timeZone` only sets the display zone — swapping it **cannot shift the
meeting**. Touch points: add `timeZone?` to `CreateEventParams`, thread it through
`createBookingEvent` → `createBookingEventViaOAuth`, and pass `pending.time_zone` from
`confirm/[token].ts:132-141` and `browserTz` from `manual.ts:220-229`.

Caveat to verify before claiming the ask is met: recipients who have a Google account see the event card
in **their own** Calendar timezone regardless of what we set, so the change is only observable in the
subject line and for non-Google recipients. Whether Google's subject uses the event's `timeZone` or the
organizer calendar's default is worth one test send rather than an assumption. If it turns out to use
the organizer default, the fallback is to stop relying on Google's mail for this and put the correctly
zoned time in our own Resend confirmation — which `confirm/[token].ts:269-280` already does correctly.

### R6. "Clients" → "Client Portal"

`src/pages/Admin.tsx:255` — `<a href="/admin/clients" …>Clients</a>`. Change the text only; the route
stays `/admin/clients`.

Note the destination page already calls itself "Admin Client Portal" (`AdminClients.tsx:467`), and
`Nav.tsx:24` uses "Client Portal" for the *public* `/client-portal` page. So after this change two
different links read "Client Portal" — one admin-only, one public. Suggest "Client Portal" on the admin
button as asked and leaving the page heading as "Admin Client Portal" to keep them distinguishable.

### R7. Drive usage alongside the storage check

Valid — nothing checks Drive today. `functions/api/admin/r2-usage.ts` lists `portfolio/` objects in R2
and compares against the 10 GB free tier; `Admin.tsx:251-270` renders it behind the "Check storage"
button (cheap path by default, `?checkQuota=true` for the real LIST).

Drive quota comes from `GET https://www.googleapis.com/drive/v3/about?fields=storageQuota`, which
returns `{limit, usage, usageInDrive, usageInDriveTrash}`. Feasible with what is already configured:
`ensureClientDriveFolder` already calls Drive with the OAuth refresh token, so the credential and scope
exist. The only plumbing needed is exporting `getDriveAccessToken` from `google-drive.ts:13` (currently
module-private) or adding a `getDriveStorageQuota(env)` beside it.

Three things to get right:
- `storageQuota` is **account-wide** — Drive + Gmail + Photos on the OAuth account, 15 GB on a free
  Gmail. It is not scoped to our root folder. Label it as such; "Drive 4.2 GB of 15 GB (whole account)".
- `limit` is **absent** from the response for unlimited/pooled accounts. Handle the missing key rather
  than rendering `NaN%`.
- Keep it on the same on-demand path as R2 (`?checkQuota=true`) — it is a Google round trip, and the
  cheap path exists specifically to avoid per-request cost.

### R8a / R8b / R9. Drive link: edit button, add button, hyperlink

All three are the same block, `src/pages/AdminClients.tsx:793-838`. Current state: a permanently-editable
`<input>` pre-filled with `client.drive_folder_url`, a conditional **Copy** button (only when a link
exists, line 809), a permanently-visible **Save**, an "✎ manual" badge (line 837), inline validation
against `/drive/folders/` (line 25-37, 288-299) and an "Unsaved changes" marker (line 824).

- **R8a — "add an edit button".** The save path already works: `handleSaveDriveLink` (line 301) →
  `PATCH /api/admin/clients/drive-folder` with `{contact_id, folder_url}` and no `year`, which
  `drive-folder.ts:103-120` handles as the client-level write (sets `contacts.drive_folder_url`,
  `drive_folder_id`, `drive_is_manual = 1`, and refreshes `parent_folder_*` on the year rows). So this
  is not missing functionality — it is a view/edit mode toggle. That is worth doing anyway, because it
  is what makes R9 possible.
- **R8b — "add button when no link exists".** Also already functional: the input renders empty and Save
  works, since the PATCH requires only `contact_id` + `folder_url`. Affordance only — an empty text box
  does not read as "you may create one here". A dedicated "+ Add Drive link" button in the empty state
  is the right call.
- **R9 — "hyperlink when the edit button is not active".** This is the only one of the three that is a
  genuine gap. The client-level link is *never* clickable today; only the per-year folders are
  (`AdminClients.tsx:766-770`). Read mode should render
  `<a href={drive_folder_url} target="_blank" rel="noopener noreferrer">`, and only render the anchor
  when the value passes `isValidDriveFolderUrl` (line 25) — legacy rows can hold `fake-…` ids from stub
  runs, and `email.ts:288` sets the precedent of refusing to use a non-`https://` value as an `href`.

Suggested end state per card: **read mode** = hyperlink + Copy + "✎ manual" badge + `Edit` /
`+ Add Drive link`; **edit mode** = today's input + validation + Save + Cancel.

### R10. Icons in the Actions column

Valid. Today `AdminClients.tsx:900-917` (desktop) and `946-960` (mobile) render one red pill reading
"Delete", identical for past and upcoming rows. No send control exists per row — forwarding is
client-level only, via the checkbox column plus "Send selected (n)" in the card header (line 775-784).

The ask works, with one constraint worth knowing before it is built:

- **Trash icon on past rows.** Fine as-is — `deleteBooking` has no upcoming restriction, and
  `AdminClients.tsx:343-349` already sorts past rows to the bottom and blocks their checkboxes.
- **Email icon on the row.** The backend supports it: `send-email.ts:56-67` takes `booking_ids` and
  validates every id against the contact's **upcoming confirmed** set, 400ing otherwise
  (`AdminClients.tsx:62` already maps that to "Past meetings cannot be forwarded"). A single-row send is
  just `sendAdminClientEmail(contact_id, [booking_id])`. So the icon **must be hidden or disabled on
  past rows** — it will 400 otherwise.
- The email icon then creates a second send path alongside the F2 checkbox flow. That is fine, but it
  should read as a shortcut, not a competing mechanism — same handler, and the header button keeps the
  multi-select case.

Accessibility: icon-only buttons need `aria-label` and `title`. The existing labels
(`Delete booking for ${client.email} at ${r.slot_start}`, line 911) should be kept verbatim, not
dropped along with the visible text — that regression is easy to make here.

### R11. Drop "Also" from the cancel checkbox

`src/pages/AdminClients.tsx:664` — "Also cancel meeting and free calendar?" → "Cancel meeting and free
calendar?". Single occurrence; the sibling checkbox at line 668 ("Notify client by email?") already
reads correctly. Note the modal's own confirm button is also labelled "Cancel" (line 671, meaning
"dismiss") — after this change the dialog holds "Cancel meeting and free calendar?" and a "Cancel"
button that does the opposite. Consider renaming the dismiss button to "Keep booking" while in there.

### R12. Phone / first name / last name on the client portal

**Already done on the admin card** — `AdminClients.tsx:757-762` renders
`{first_name} {last_name} · {email}` and appends `· {phone}` when present. The data is there end to end:
`search.ts:31,45,58` selects `c.phone`, and `AdminClientCard` (`src/lib/api.ts:225-231`) types it.

So if "client portal" meant the admin page, there is nothing to build; the remaining gap is that phone
is display-only (see R13).

If you meant the **public** `/client-portal`, then it is a real gap and a different one: the page
(`src/pages/ClientPortal.tsx`) only collects an email address and never displays anything back — by
design, for anti-enumeration (line 154, "If an account with that email exists…"). The details land in
the email, and `buildClientPortalDriveEmail` (`email.ts:245-279`) greets with `firstName` only, showing
no last name and no phone. Adding them there is doable — `client-portal/lookup.ts` already loads the
contact — but note this emails PII to whoever typed the address, on an unauthenticated endpoint. That
is a deliberate trade-off, not an oversight. **Confirm which surface you meant**; I have assumed the
admin card and marked it already-satisfied.

### R13. Admin edits first / last name

Names are already writable, but only as a **side effect**: `manual.ts:98-110` upserts the contact on
every Add Booking and overwrites `first_name`, `last_name` (and `phone`, when supplied) for an existing
email. So the admin can rename a client today only by creating a booking they do not want.

There is no name-edit endpoint. `drive-folder.ts` PATCHes Drive fields only; `search.ts` is read-only.
The card header (`AdminClients.tsx:757-762`) is static text.

Given the stated purpose — "mainly during search" — the useful scope is a small
`PATCH /api/admin/clients/{contact_id}` accepting `{first_name, last_name, phone}`, plus an inline edit
on the card header. Two things it must do that the existing writers do not:
- Trim and reject empty strings. `manual.ts` requires both names (line 65) but nothing else does, and a
  blank name makes the client unfindable by the very search this exists to serve.
- Leave `email` alone. Email is the Drive folder name (`google-drive.ts:173`) and the
  `client_drive_folders.email` NOT NULL key; renaming it would orphan the folder. Editing names and
  phone is safe; editing email is not, and should not be in this control.

### R14. Expand / collapse long purpose

Valid. `purpose` is unbounded: `booking.ts:66` does `String(body.purpose).trim()` with no length check,
`manual.ts` has none either, and the column is plain `TEXT`. The desktop cell renders it raw —
`AdminClients.tsx:888`, `<td className="p-2">{r.purpose || ''}</td>` — with no truncation, so a
500-character purpose stretches the row and pushes Timezone / Meeting URL / Status / Actions off to the
right. (The Meeting URL cell next to it already does the opposite, hard-truncating at
`truncate max-w-[140px]`, line 890.) Mobile inlines it into a single `text-xs` line at 943.

A ~100-character clamp with a "Show more" / "Show less" toggle is right. Two notes:
- Keep the full text in the DOM (`title` attribute or a collapsed element), not a substring — the
  purpose is also what goes into the calendar invite description, and admins compare them.
- While clamping the display, consider a server-side cap on input too (say 2000 chars) in `booking.ts:66`
  — it currently accepts a megabyte of text into a field that is echoed into the Google event
  description and into email HTML. `escapeHtml` (`email.ts:4`) handles the injection risk; size is
  unhandled.

---

## Rev 3 — suggested grouping

**Copy-only, no behaviour change** (one small PR): R1 copy line, R6, R11, plus the R2 copy *if* the
window is enforced in the same change.

**UI work on the admin card**: R8a/R8b/R9 (Drive link read/edit mode), R10 (action icons), R13 (name
edit + its endpoint), R14 (purpose clamp). These all touch `AdminClients.tsx` and should land together
to avoid three rewrites of the same card.

**Backend / integration**: R2's 24-hour cancel window (`cancel/[token].ts`), R3 (Drive link on the
confirm page), R5 (thread `time_zone` into the Calendar event), R7 (Drive quota endpoint).

**Config, not code**: R4 — rename the booking calendar and the OAuth account.

**Needs a decision before work starts**: R2 (copy alone, or copy + enforcement), R12 (admin card —
already done — or the public portal email), and the R1 dead-panel bug (restore `pending: true`, or
delete the unreachable panel).

---

# Rev 4 — requested changes, verified 2026-08-29

Rev 3 (R1–R14) shipped and its suite is green (`docker compose --profile test run --rm tests` →
lint ok, build ok, 92 frontend + 272 worker tests). This section is the next batch of requests,
each checked against the working tree.

Two of them turned out to share a single root cause that is bigger than either symptom (S-CSS),
and one turned out to be a latent data-loss bug of exactly the same class as R13 (S7).

| # | Ask | Verdict | Anchor |
|---|---|---|---|
| S1 | Move the confirm-intent box near "Book this time" | ✅ valid | `BookingForm.tsx:339`, submit at `:420` |
| S2 | Booking-requested panel looks bad; reword | ✅ valid (it is not a modal) | `BookingForm.tsx:256-290` |
| S3 | Confirm page carries too much information | ✅ valid — includes developer diagnostics | `booking/confirm/[token].ts:324-363` |
| S4 | Cannot update the Drive link after clicking Edit | ✅ real — **caused by S6**, not by the handler | see S-CSS |
| S5 | "GDrive:" → "Google Drive" | ✅ valid, 3 occurrences | `AdminClients.tsx:888,912,676` |
| S6 | Save button is invisible | ✅ **confirmed — `bg-blue-600` does not exist in this project** | see S-CSS |
| S7 | Client cancel deletes the row; should keep it as cancelled | ✅ **confirmed, and the cause is a missing column** | `cancel/[token].ts:224-230` |
| S8 | Allow selecting past rows; tiered delete; soft delete | ✅ behaviour confirmed; design needs decisions | `AdminClients.tsx:980,1070`, `admin/bookings/[id].ts:110` |

---

## S-CSS. Root cause of S4 and S6: this project has no Tailwind

This is the headline finding. **There is no Tailwind in the repo** — no `tailwindcss` dependency in
`package.json`, no `tailwind.config.*`, no `@tailwind` directives. `src/index.css` is a hand-written
678-line stylesheet that reimplements a *subset* of Tailwind's class names by hand.

Any Tailwind-looking class not present in that file silently does nothing. There is no build error,
no lint error, and no test failure — the class is just inert.

Combined with the base rule at `src/index.css:55-62`:

```css
button {
  background-color: transparent;
  background-image: none;
  border: 0;
  padding: 0;
  ...
}
```

…a button styled `text-white bg-blue-600` renders as **white text on a transparent background**, i.e.
invisible on the white card.

Full inventory of background utilities that *do* exist:

```
bg-amber-100 bg-amber-50 bg-black bg-blue-50 bg-gray-100 bg-gray-200 bg-gray-300 bg-gray-400
bg-gray-50 bg-green-200 bg-green-400 bg-green-50 bg-green-500 bg-green-600 bg-hero bg-orange-50
bg-red-200 bg-red-50 bg-slate-100 bg-slate-200 bg-slate-50 bg-slate-900 bg-white
```

`bg-blue-600` and `bg-red-600` are **not** among them. Neither is `text-blue-600`.

### Controls that are currently invisible or miscoloured

| Control | File:line | Classes | Effect |
|---|---|---|---|
| Drive **Save** | `AdminClients.tsx:932` | `text-white bg-blue-600` | invisible → **this is S4** |
| Drive **Edit / + Add Drive link** | `:902` | `text-white bg-blue-600` | invisible |
| Client-name **Save** | `:826` | `bg-blue-600 text-white` | invisible |
| Row **trash** icon (desktop) | `:1035` | `bg-red-600 text-white` + `fill="currentColor"` | invisible |
| Row **trash** icon (mobile) | `:1098` | `bg-red-600 text-white` | invisible |
| Modal **Delete** | `:722` | `bg-red-600 text-white` | invisible (pre-existing) |
| Drive hyperlink, year-folder links, "Show more", name **Edit** | `:889,:767,:1000,:833` | `text-blue-600` | falls back to inherited slate; `underline` still applies, so still discoverable |

Arbitrary-value classes are also inert (a hand-written sheet cannot generate them):
`min-w-[280px]`, `max-w-[360px]`, `max-w-[280px]`, `text-[10px]`, `text-[11px]`, `w-[120px]`,
`w-[140px]`, `mt-0.5`.

### Proof that S4 is *only* the invisible button

Six throwaway render tests were run against `AdminClients` in JSDOM (then deleted) covering: edit an
existing link, add a link when none exists, replace a stub `fake-` link, two clients side by side, and
the card re-render after save. **All six passed** — the Save button is in the DOM, the input is
controlled correctly, `updateAdminDriveFolderClientLevel(contact_id, url)` is called with the right
arguments, and the card shows the new link afterwards.

JSDOM has no layout or CSS engine, which is exactly why the existing test suite is green while the
button is unusable in a browser. The Edit→Save logic is correct; the admin simply cannot see the button
to click it.

Two theories were tested and **ruled out**:
- *Route shadowing.* The new `functions/api/admin/clients/[id].ts` does not swallow
  `PATCH /api/admin/clients/drive-folder`. Building the Functions worker shows the route table orders
  `/api/admin/clients/drive-folder` before `/api/admin/clients/:id`, so the static route wins.
- *Unapplied migration `0015`.* If `contacts.drive_folder_id` were missing, `search.ts:32` would 500 and
  no clients would render at all. Clients render, so `0015` is applied.

### Recommendation

Fix the class inventory, not the individual buttons — otherwise every future component hits this again.
Ranked:

- **P0** — add the missing utilities to `src/index.css`: `bg-blue-600`, `bg-blue-700` (hover),
  `bg-red-600`, `bg-red-700` (hover), `text-blue-600`. That alone fixes S4, S6 and the invisible trash
  icons in one change.
- **P1** — add the eight missing arbitrary-value classes as named utilities, or replace their usages
  with classes that exist.
- **P1** — add a guard so this cannot recur silently: a unit test (or a small script in the docker test
  step) that extracts every `className` token from `src/**/*.tsx` and asserts each one resolves in
  `src/index.css`. This is cheap and would have caught all of the above at commit time.
- **P2** — decide whether to keep the hand-rolled shim or adopt real Tailwind. The shim has now produced
  a user-visible outage twice; that is the actual argument for switching, but it is a separate piece of
  work and should not block the P0.

---

## S1. Confirm-intent box sits far from the button that triggers it

Valid as described.

The duplicate-booking warning renders at `BookingForm.tsx:339-360`, immediately after the form header
and **before** the first name field. The submit button it responds to — "Book this time" — is at
`:420-427`, roughly 85 lines and five form controls below it.

The sequence is: the visitor scrolls to the bottom, presses "Book this time", the request returns a
`warning`, and the response — plus the "Confirm and book again" button they now need — appears above
the fold, off-screen. Nothing scrolls it into view. To the visitor the button simply did nothing.

Fix: move the `{warning && …}` block to sit directly above the submit button, after the Turnstile
container at `:400-418`. Keep `role="alert"` semantics so it is announced, and consider
`scrollIntoView({ block: 'nearest' })` when `warning` transitions from null.

Note the same pattern applies to the `{error && …}` block at `:363-370` — it is also at the top and has
the same problem after a failed submit. Worth moving both.

---

## S2. "Booking Requested" panel

Valid. First, a correction to the framing: **it is not a modal.** It is the `if (pending)` early-return
of `BookingForm` (`:256-290`), so it replaces the form in place inside `#slot-picker` on the home page.
There is no overlay, no focus trap, and no focus move — a screen-reader or keyboard user gets no signal
that the form they were filling in has been swapped out.

Current reading order:

1. "Booking Requested" (`:260`)
2. `{pending.message}` — the API string "Confirmation email sent. Please click the link to finalize your booking." (`:261`)
3. Email (`:262`)
4. Date (`:263`)
5. Purpose (`:264`)
6. dev-only confirm-link box (`:265-273`, production-suppressed since R-fix #2)
7. "We sent you a confirmation link. Click it within 30 minutes and the meeting is booked." (`:274`)
8. email-failure warning (`:275-280`)
9. "No email yet? Check your spam folder." (`:281`)
10. "Back" (`:283-287`)

Problems, in severity order:

- **P0 — the critical fact is buried and duplicated.** The one thing the visitor must understand is
  *this is not booked yet, go click the email*. It appears twice, at positions 2 and 7, in two different
  voices, with the echoed form data in between. Items 2 and 7 say the same thing; one should go.
- **P0 — the heading contradicts the body.** "Booking Requested" reads as a completed action. Nothing in
  the heading says an action is still required.
- **P1 — "Back" is ambiguous.** It clears `pending` and returns to the form with the same slot
  (`:284`). A visitor reading "Back" after being told to check their email may take it as "cancel", or
  may press it and re-submit, creating a second pending row for the same slot (which then trips the
  duplicate-booking warning from S1 — the one they cannot see).
- **P1 — the 30-minute expiry is stated once, in the smallest text, seventh.** It is the only
  time-sensitive fact on the page.
- **P2 — no resend affordance.** If the email does not arrive the visitor's only route is to start over.
  There is no resend endpoint today; adding one is a backend change, so record it as a gap rather than a
  copy fix.

Requested wording is right in substance. Suggested copy, keeping the stakeholder's phrasing:

- Heading: **"Almost done — check your email"**
- Lead: **"Please click the link inside the email to finalize your booking. Your meeting is not booked until you do."**
- Then: **"Sent to {email} — the link expires in 30 minutes."**
- Then the slot and purpose as a quiet summary block.
- Spam line: keep, unchanged.
- Button: **"Change details"** rather than "Back".

Note "the link inside email" → "the link inside **the** email" for grammar.

---

## S3. `/api/booking/confirm` page carries developer diagnostics

Valid. The success HTML is `booking/confirm/[token].ts:324-363`. Triage:

| Element | Line | Call |
|---|---|---|
| "Meeting Confirmed ✅" + greeting + formatted date | 327-328 | **KEEP** — the payload of the page |
| Purpose box | 329 | **KEEP**, demote visually |
| Meet link printed as a full raw URL | 330 | **DEMOTE** — label the link, don't print the URL; there is already an "Open Meet" button two lines below |
| Drive upload folder | 331 | **KEEP** and promote — this is the only call to action that asks the client to do something |
| `gcalError` raw string in a yellow box | 332 | **CUT** — this is the vendor's error text ("Bare event created without Meet — group calendar may not support hangoutsMeet via SA…"). `src/lib/bookingMessages.ts` exists precisely to stop this happening on the visitor-facing side; that lesson never reached this file |
| Cancel URL printed in full as visible text | 333 | **DEMOTE** — a labelled link plus the 24-hour policy |
| Open Meet / Back to home / Download .ics | 334-361 | **KEEP** two; **CUT** .ics — the client already has a real Google Calendar invite in their inbox, and a second competing calendar file invites double entries |
| "Purpose included in calendar invite: … — Google event `abc123xyz` source `live`" | 362 | **CUT** — pure diagnostics. The event id and the literal word "stub"/"live" are meaningless to a client and undermine trust |

Two further findings on this file:

- **P0 (security) — user-controlled values are interpolated unescaped.** `pending.first_name` (`:328`),
  `pending.purpose` (`:329`, `:362`) and `meetLink` (`:330`, `:334`) go straight into the HTML string.
  `functions/_lib/email.ts:4` defines `escapeHtml` and the email templates all use it; this page does
  not. Rev 3's L5 fix escaped the email templates and missed this page. Purpose is free text from a
  public endpoint, capped at 2000 chars but not sanitised.
- **P1 — the sibling error states share the problem.** The not-found (`:69-78`), expired (`:92-101`) and
  already-confirmed (`:106-115`) responses print the raw token prefix and the raw `expires_at`
  timestamp. Same page, same audience, same treatment needed.

Information hierarchy for this moment: (1) it's confirmed, here's when; (2) upload your documents here;
(3) join link; (4) how to cancel. Everything else belongs in the email or the logs.

---

## S4. Cannot update the Drive link after clicking Edit

Real, and fully explained by **S-CSS** — the Save button is invisible. The Edit→Save logic itself is
correct and proven by the six render tests described above. No separate fix is needed beyond adding
`bg-blue-600` to `src/index.css`.

---

## S5. "GDrive" → "Google Drive"

Valid. Three occurrences, all in `src/pages/AdminClients.tsx`:

- `:888` — read-mode label `GDrive:`
- `:912` — edit-mode label `GDrive:`
- `:676` — Add Booking modal helper text, "GDrive auto generated based on email+year, Meet auto
  generated from time" (also worth rewriting as a sentence: "The Google Drive folder and Meet link are
  created automatically.")

---

## S6. Save button invisible

Confirmed and root-caused in **S-CSS**. Not limited to Save — the Edit, "+ Add Drive link", client-name
Save, both trash icons and the modal Delete button are all invisible for the same reason.

---

## S7. Client cancellation deletes the row — confirmed, and it is a missing column

Valid, and the cause is not a design decision. The code already *intends* to do what is being asked
for. `functions/api/cancel/[token].ts:222-231`:

```ts
// Mark as cancelled in D1 (or delete — we mark cancelled for audit)
try {
  const updateStmt = db.prepare('UPDATE bookings SET status = ?1, updated_at = datetime("now") WHERE id = ?2')
  await updateStmt.bind('cancelled', booking.id).run()
} catch {
  try {
    const delStmt = db.prepare('DELETE FROM bookings WHERE id = ?1')
    await delStmt.bind(booking.id).run()
  } catch {}
}
```

**`bookings` has no `updated_at` column.** `migrations/0001_initial.sql:59-67` defines
`id, contact_id, calendar_event_id, purpose, cancel_token, status, created_at`; `0007` adds
`slot_start`/`slot_end`; `0014` adds `meet_link`/`time_zone`/`drive_folder_url`. No migration ever adds
`updated_at`.

Replayed against real SQLite built from those migrations:

```
UPDATE bookings SET status='cancelled', updated_at=datetime('now') WHERE id='b1';
  -> Error: in prepare, no such column: updated_at
```

So the UPDATE throws on every single cancellation, the bare `catch` swallows it, and the fallback
`DELETE FROM bookings` runs. The row is destroyed exactly as reported. This is the same defect class as
R13 and B1 — a statement that only fails against a real database, invisible to mocked-D1 tests.

Fixing it is two changes, and the second is easy to miss:

- **P0** — drop `updated_at` from the UPDATE (nothing reads it), or add it in migration `0016`. Then
  delete the `DELETE` fallback entirely: silently destroying a booking because an UPDATE failed is never
  the behaviour you want, and it is what hid this bug.
- **P0** — the row still will not appear in the admin table, because every consumer filters on
  `status = 'confirmed'`:
  - `admin/clients/search.ts:106` — the meetings query. Must include cancelled rows.
  - `admin/clients/search.ts:62` — the `EXISTS` clause for the date-only search. A client whose only
    bookings are cancelled currently disappears from search entirely.
  - `admin/clients/send-email.ts:47` and `client-portal/lookup.ts:107` — these should **keep** filtering
    to confirmed; a cancelled meeting must never be forwarded to a client.

The UI half already works: `AdminClientRow` carries `status`, and the table renders a Status column at
`AdminClients.tsx:1006`. It needs a chip style rather than raw text, and `isUpcomingConfirmed`
(`:343-349`) already excludes cancelled rows from selection, which is correct.

Also note `deleteCalendarEvent` is called *before* the DB write (`:218-220`), so the Google event is
already gone by the time the row is destroyed — a cancelled booking cannot be restored to its original
calendar event. See S8.

---

## S8. Selecting past rows, tiered delete, soft delete

### Behaviour confirmed

- **Past rows cannot be selected.** `disabled={!canSelect}` on both the desktop checkbox
  (`AdminClients.tsx:980`) and the mobile one (`:1070`), where
  `canSelect = isUpcomingConfirmed(r)` (`:343-349`). `toggleSelectAll` (`:351-364`) likewise only ever
  selects upcoming rows.
- **Admin delete is a hard delete.** `functions/api/admin/bookings/[id].ts:110` —
  `DELETE FROM bookings WHERE id = ?`. There is no soft-delete column anywhere in the schema.
- **The existing "Undo" is not an undo.** `handleDeleteBooking` (`:400-434`) restores by calling
  `createManualBooking(...)`, which mints a **new booking id, a new Google Calendar event and a new
  cancel token**, and re-runs the Drive folder logic. Any cancel link the client already holds is dead.
- **The delete modal defaults** to `cancelMeetingChecked = true` and `notifyClientChecked = false`
  (`:908-909`), so the current default is "kill the calendar event, tell the client nothing".

So the description is accurate on every point.

### Design assessment

The proposal is sound in intent. Three tensions to resolve before building it:

- **P0 — one checkbox column cannot mean two things.** Today ticking a row means "forward this meeting
  to the client". The proposal adds "and also this is what I'm about to delete". Same control, one
  benign meaning and one destructive one, with the destructive one newly enabled on rows that were
  previously unselectable. That is how an admin emails a client about a meeting they meant to purge, or
  purges one they meant to email. Recommended: keep one checkbox column, but make the *action bar* carry
  the meaning — show "Send selected (n)" and "Delete selected (n)" side by side, with Send disabled when
  the selection contains any non-upcoming row, and an explicit count breakdown ("3 selected — 2 past,
  1 upcoming").
- **P0 — "delete" and "cancel the meeting" must stay separate.** They have different blast radii:
  removing a row from the admin's list is reversible bookkeeping; cancelling deletes a real Google
  Calendar event off the client's calendar and (per the proposal) emails them. The tiering described —
  past/cancelled delete directly, upcoming-confirmed prompts — is the right instinct. Make the prompt
  state the consequence in the button, not just the checkbox: "Cancel meeting & notify client" vs
  "Remove from list only".
- **P1 — "revertible" cannot be honest about the calendar.** A cancelled Google event cannot be
  un-cancelled. Restoring a soft-deleted booking that was also cancelled has to create a *new* event and
  a *new* cancel token, which is what today's fake Undo already does badly. The UI must not promise
  "Undo"; it should say "Restore" and warn that a new invitation will be sent. If the record was
  soft-deleted *without* cancelling, restore is genuinely lossless — that distinction should be visible
  in the restore dialog.

### Data model implications

- `ALTER TABLE bookings ADD COLUMN deleted_at TEXT` (null = visible) — soft delete.
- `ALTER TABLE bookings ADD COLUMN deleted_reason TEXT` — distinguishes "removed from list" from
  "cancelled by admin", which is what makes an honest restore possible.
- The existing `status` CHECK constraint is `CHECK (status IN ('confirmed','cancelled'))`
  (`0001_initial.sql:65`). Any new status value requires a table rebuild in SQLite — so prefer
  `deleted_at` over adding a `'deleted'` status.
- Every read path needs `AND deleted_at IS NULL` added: `search.ts` (both queries), `send-email.ts`,
  `client-portal/lookup.ts`, `bookings/lookup.ts`.
- A "Show hidden" toggle on the admin card is the minimum surface for restore; without it soft-deleted
  rows are unreachable and the feature is indistinguishable from a hard delete.

### Status chips

With S7 fixed, the Status column carries real values. Suggested: `Upcoming` (slate), `Completed`
(grey), `Cancelled` (red outline), `Hidden` (amber, only when "Show hidden" is on). Note `bg-red-600`
does not exist — see S-CSS — so use the existing `bg-red-50`/`text-red-700` pair for the cancelled chip.

---

## Rev 4 — suggested sequencing

**PR-11a — the CSS shim (unblocks S4 and S6, one file):** add `bg-blue-600`, `bg-blue-700`,
`bg-red-600`, `bg-red-700`, `text-blue-600` and the eight arbitrary-value utilities to
`src/index.css`, plus the className-resolves-to-CSS guard test. Nothing else in this batch should land
before this, because the admin card is unusable without it.

**PR-11b — data integrity (S7):** drop `updated_at` from the cancel UPDATE, delete the `DELETE`
fallback, and let cancelled rows through `search.ts`. Add one real-SQLite test, as with B1.

**PR-11c — copy and layout (S1, S2, S3, S5):** move the warning/error blocks next to the submit button,
rewrite the pending panel, strip diagnostics from the confirm page and escape its interpolations,
rename GDrive → Google Drive.

**PR-11d — S8**, once the three decisions above are made. Largest of the four and the only one needing
a migration.

**Needs a decision:** whether "Back" on the pending panel becomes "Change details" or is removed
entirely; whether to add a resend-confirmation endpoint (S2 P2); and whether the CSS shim is patched or
replaced with real Tailwind (S-CSS P2).

---

# Rev 4 addendum — UX review findings, verified 2026-08-29

Three independent design reviews were run against S2 (pending panel), S3 (confirm page) and S8
(admin delete flow). They surfaced **ten defects that are not design opinions**. Each was
re-verified against the source before being recorded here; every one is confirmed.

The most important structural finding: **the CSS guard described in S-CSS used to exist.**
`src/index.css:412-417` says:

> *"Utility completion — every class name used in `src/**.tsx` must be defined here. This project has
> no Tailwind build step, so undefined classes silently do nothing (that is what made hover-only
> overlays render permanently and admin spacing collapse). `npm test` enforces coverage via
> styles.coverage.test.ts."*

**`styles.coverage.test.ts` does not exist anywhere in the repo.** So this exact failure mode has
already caused two prior visible regressions, a guard was written, the guard was lost, and it has now
caused a third (S4/S6). Restoring it is the single highest-leverage item in this document.

## Verified defects

| # | Defect | Evidence |
|---|---|---|
| V1 | **Pending panel states the wrong expiry.** Panel says "Click it within 30 minutes"; the token is valid for **one hour**. A visitor returning at 40 minutes believes they missed it and abandons a live booking. | `BookingForm.tsx:274` vs `booking.ts:243` (`60 * 60 * 1000`) |
| V2 | **On email failure the panel still says the email was sent.** `pending.message` is hardcoded server-side and rendered unconditionally, ~15px above the box saying the send failed. | `booking.ts:298`, rendered `BookingForm.tsx:261`, failure box `:275-280` |
| V3 | **The CSS coverage guard is claimed but absent.** See above. | `index.css:412-417`; no such file |
| V4 | **Confirm page ships dead Meet links as live ones.** `createBookingEvent` never returns an empty `meetLink` — it coalesces to `https://meet.google.com/fake-no-meet-…`. So the page's `${meetLink \|\| 'No Meet link…'}` fallback is unreachable, and the client gets a real-looking 404 URL **plus** a large primary "Open Meet →" button pointing at it. | `google-calendar.ts:812`, `google-oauth.ts:223` vs `confirm/[token].ts:331,336` |
| V5 | **The .ics button is inert for any client with an apostrophe.** `pending.first_name` / `last_name` / `purpose` are interpolated into a **single-quoted JS string inside an `onclick` attribute**. `O'Brien`, or a purpose of "I'm starting an LLC", terminates the string, the handler fails to parse, and the button silently does nothing. `escapeHtml` does **not** fix this — the HTML parser decodes `&#39;` back to `'` before JS sees it. Must move to a server endpoint. | `confirm/[token].ts:344-348` |
| V6 | **The admin "Notify client by email?" checkbox is a lie.** `deleteBookingEvent` calls Google with `?sendUpdates=all` on both the OAuth and SA paths, so Google emails the attendee whenever the event is deleted — regardless of the checkbox. And "Cancel meeting and free calendar?" defaults **on** for every row including past ones, so tidying away last March's meeting tells that client their meeting is cancelled. | `google-calendar.ts:418,489`; defaults `AdminClients.tsx:908-909` |
| V7 | **Third instance of the missing-`updated_at` bug, and this one is silent.** `booking.ts:215` runs `UPDATE contacts SET first_name…, updated_at = datetime("now")` with `.catch(() => {})` chained. `contacts` has no `updated_at`, so the statement always throws and is always swallowed — a returning client who changed their surname or phone never has it updated, with no log and no fallback. | `booking.ts:215-216` |
| V8 | **More inert CSS beyond S-CSS.** `bg-black/50` is undefined, so **neither modal has a dimming scrim** — the Add Booking and Delete dialogs float on the live page. `disabled:opacity-40` is undefined, so disabled Send/email buttons do not dim (`disabled:opacity-50` exists and should be used). | `AdminClients.tsx:546,696` and `:856,1023,1024` |
| V9 | **`bookingMessages.ts` is imported and unused in both consumers** while the thing it exists to prevent is happening. Its doc comment explains it was written so vendor error strings never reach visitors — and `BookingForm.tsx:277` renders `pending.emailResult?.error?.slice(0, 200)`, i.e. the raw Resend string (`Resend pending failed 422 {"statusCode":422,…}`). | `BookingForm.tsx:7`, `Home.tsx:18`; leak at `:277` |
| V10 | **Admin table integrity nits.** (a) The UI's upcoming boundary allows 60s grace and keys off `slot_start`; `send-email.ts:47` has no grace — a row 0-60s past start is tickable and 400s on send. (b) `selected` is not pruned when a row is deleted, so "Send selected (n)" keeps counting a dead booking. (c) The Undo passes `sendEmail: false`, so a client just told their meeting is cancelled gets a silent new invite; its failure branch claims "Booking restored locally" when the booking is gone; and `lastDeleted` state is set and never read. | `AdminClients.tsx:387` vs `send-email.ts:47`; `:447-449`; `:459-482`, `:406,451` |

## Design direction (from the reviews)

**S2 — pending panel.** The load-bearing sentence is seventh in reading order, at the smallest size, in
the second-lightest grey, beneath three rows echoing what the visitor typed thirty seconds ago. The
heading "Booking Requested" reads as *submitted, they'll handle it* — and the success panel uses the
identical heading with the opposite meaning. Recommended: heading **"Almost done — check your email"**;
lead **"Your time isn't booked yet. We sent a link to {email} — click it and the meeting is booked."**
as the largest body text; amber not blue (the codebase already uses amber for "you must act"); details
collapsed from four rows to two; expiry as an absolute time from the `expiresAt` already returned but
currently dropped client-side; spam line naming the searchable subject ("Confirm your meeting");
**"Back" → "Typed the wrong email?" + "Start over"** (the current Back cancels nothing — the pending row
and its live link survive); and a separate red `role="alert"` panel for the failure case instead of a
contradiction box bolted onto a success panel. The panel also needs `w-full max-w-xl mx-auto` (it
currently jumps wider than the form it replaces) and focus management (the form is destroyed in place
with no announcement).

**S3 — confirm page.** Correct hierarchy: (1) the date and time, as the visual hero; (2) upload your
documents — the only action available now, currently fifth; (3) join link and add-to-calendar; (4) the
cancellation policy as prose. The cancel URL, the full Meet URL and the purpose echo belong in the
email, which is the durable artifact. Add "we've emailed the details to {email}" to close the loop.
One dark pill on the page, and it should be the upload folder — not "Open Meet", which points at an
empty room for days. Also: the page has no `<!doctype>`, no `lang`, no `<title>` and **no viewport
meta**, so iOS Safari lays it out at 980px and shrinks it — it is currently not readable on a phone,
which was a stated constraint. All four error states ship as naked `<h1>` fragments with no layout and
no way back, and `DB not configured` names infrastructure to a stranger.

**S8 — admin delete.** The reviewer rejected the fused delete/cancel control and proposed disjoint row
sets instead, which resolves the checkbox collision without a second checkbox column:

- **Upcoming confirmed rows have no delete.** Their action is **Cancel meeting** — deletes the event,
  optionally emails, sets `status='cancelled'`, and the row *stays visible* with a Cancelled chip.
- **Cancelled and past rows have no cancel.** Their action is **Hide** — soft delete, no calendar, no
  email, reversible.

To remove a meeting you cancel it, then hide it: two deliberate steps, each with one consequence.
Never use the word "delete" in the UI; say **Hide** / **Show hidden** so it reads as a filter. Ship no
permanent delete in v1. Two orthogonal axes, never mixed in copy: *what happened to the meeting*
(Upcoming / Completed / Cancelled) is the status chip; *whether the row is in the list* (Hidden) is the
admin's view. Bulk actions are **Email** and **Hide** only — never bulk cancel. Only Hide gets an Undo,
because it is the only genuinely reversible action; cancelled rows get **Rebook**, honestly labelled,
with a dialog stating that the original event cannot be brought back.

This design needs **no new `status` value**, so the `CHECK (status IN ('confirmed','cancelled'))`
constraint at `0001_initial.sql:65` is untouched and no SQLite table rebuild is required — the reason to
prefer `deleted_at` over a `'deleted'` status. Suggested additive migration `0016`:

```sql
ALTER TABLE bookings ADD COLUMN updated_at TEXT;      -- fixes S7's silent hard delete
ALTER TABLE bookings ADD COLUMN deleted_at TEXT;      -- list visibility
ALTER TABLE bookings ADD COLUMN cancelled_at TEXT;
ALTER TABLE bookings ADD COLUMN cancelled_by TEXT;    -- 'client' | 'admin', no CHECK
ALTER TABLE bookings ADD COLUMN cancel_notified INTEGER DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_bookings_deleted_at ON bookings(deleted_at);
```

Rebook should reuse the existing row **and its `cancel_token`** — there is no reason to mint a new one,
and keeping it means the client's existing cancel link still works, narrowing the breakage to the
calendar invite alone. Today's re-create Undo structurally cannot do this, because the manual-booking
endpoint always creates a new row with a new token, which is why every cancel link the client already
holds goes dead.

Row icon buttons are `w-8 h-8` (32px) on exactly the destructive controls; `w-11`/`h-11` both exist in
the shim, so raising them to the 44px floor is free. Desktop and mobile renderers have already drifted
(the same control carries different labels) — derive the per-row action set from one shared helper
before adding three more conditional actions.

## Revised Rev 4 sequencing

**PR-11a — the CSS shim.** Now also covers `bg-black/50` (no modal scrim today) and
`disabled:opacity-40`, and its most valuable deliverable is **restoring `styles.coverage.test.ts`**,
which `index.css:412` already claims exists. Everything else waits on this.

**PR-11b — data integrity.** S7's cancel-path hard delete, V7's silent contact-update failure, and the
`updated_at` column they both need. One real-SQLite test, as with B1.

**PR-11c — client-facing correctness.** V1 (wrong expiry), V2 (false success on email failure), V4
(dead Meet links presented as live), V5 (.ics broken by apostrophes), plus the viewport meta on the
confirm page. These are the four that cost bookings.

**PR-11d — copy and layout.** S1, S2, S3, S5 as designed above.

**PR-11e — S8.** Largest; needs migration `0016` and the three decisions in S8.

**V6 needs a decision now, ahead of any of it:** the admin's "Notify client by email?" checkbox does not
control whether the client is emailed. Either drop `sendUpdates=all` when the box is unchecked, or
relabel the checkbox to describe what it actually does.

---

# Rev 5 — requested changes, verified 2026-08-29

Checked against the working tree after Rev 4 landed (suite green: lint, build, 93 frontend + 275 worker
tests). No code written for these — verification only.

| # | Ask | Verdict | Anchor |
|---|---|---|---|
| T1 | Nav links dead on the client portal | ✅ valid — and worse than "dead" for Home | `Nav.tsx:19-25,55-62,76` |
| T2 | Keep `.ics`, drop "Open Meet", show full Meet URL + copy button | ✅ valid | `confirm/[token].ts:389-397` |
| T3 | Put purpose + Drive link in the Calendar invite | ⚠️ purpose **already there**; Drive link is not, and ordering blocks the simple fix | `google-oauth.ts:113`, `confirm/[token].ts:166,229` |
| T4 | Admin-selectable timezone under "Your site"; admin table in admin's zone, mention client's | ✅ valid — clear precedent exists, but one hidden dependency makes it bigger than it looks | `Admin.tsx:308`, `google-calendar.ts:93,95-120` |
| T5 | Admin-selectable working start/end, whole-hour slots only | ✅ valid — whole-hour is already guaranteed, but only if the inputs are whole hours | `slots.ts:67-73`, `google-calendar.ts:48-59,145` |

---

## T1. Nav links do nothing on `/client-portal`

Valid, and the Home link is the worst of the set — it does something actively wrong rather than nothing.

**Section links** (`Nav.tsx:19-25`) use bare fragments — `#services`, `#about`, `#testimonials`,
`#work`. On `/client-portal` those resolve to `/client-portal#services`. That page renders only the
email form, so there is no matching element and the click is inert. Same for **"Book a free call"**
(`:76`, `href="#calendar"`). The mobile menu reuses the same `sectionLinks` array, so it has the
identical problem.

**The wordmark** (`:55-62`) is different:

```tsx
<a href="/" onClick={(e) => {
  e.preventDefault()
  window.scrollTo({ top: 0, behavior: 'smooth' })
  window.history.pushState(null, '', '/')
}}>
```

`App.tsx:16` reads `window.location.pathname` **once at render**, and there is no router and no
`popstate` listener. So on the client portal this rewrites the address bar to `/` and scrolls to the
top while leaving the Client Portal form on screen. The URL and the content disagree, and a refresh
then silently swaps the page. That is a worse failure than an inert link, because the user has no
signal anything happened.

**Fix:**
- Make the section links and the CTA root-relative: `/#services`, `/#about`, `/#testimonials`,
  `/#work`, `/#calendar`. They then work from any page and keep working on the home page.
- Gate the wordmark's `preventDefault()` on `window.location.pathname === '/'`. Off the home page,
  let the browser navigate normally. The smooth-scroll behaviour is worth keeping *on* the home page,
  which is presumably why the handler exists.

**Scope:** any page that renders `<Layout>` and is not `/`. Today that is `/client-portal` only, but
the bug is in `Nav`, so every future page inherits it.

---

## T2. Confirm page — restore `.ics`, drop "Open Meet", show the full Meet link with a copy button

Valid. Current state at `functions/api/booking/confirm/[token].ts`:

- **"Open Meet" appears twice** — an inline text link (`:389`) and again as a pill in the button row
  (`:397`). Both should go.
- **The `.ics` button was removed in Rev 4.** The only remaining trace is a copy line at `:390`:
  *"Add to your calendar from the invite in your inbox — no extra .ics needed."* That sentence has to
  go with the change, or the page will contradict the button sitting next to it.

Two implementation constraints worth deciding up front, because both were the cause of earlier P0s:

1. **Do not re-add `.ics` as an inline `onclick`.** The previous implementation interpolated
   `first_name` / `purpose` into a single-quoted JS string inside an HTML attribute; a client named
   `O'Brien`, or a purpose containing an apostrophe, made the handler fail to parse and the button
   silently did nothing. `escapeHtml` does not fix that — the HTML parser decodes the entity before JS
   sees it. Ship it as a server endpoint instead: `GET /api/booking/:id/invite.ics`, `Content-Type:
   text/calendar`, `Content-Disposition: attachment; filename="meeting.ics"`. That also lets you emit
   a proper `UID` and `DTSTAMP`, which the old inline generator omitted and Outlook wants.
2. **The copy button needs JS on a page that loads none.** The page is a single self-contained HTML
   string with no site bundle. Options, in order of preference: a `<input readonly>` holding the URL
   that the user can select and copy with no JS at all; or a minimal inline handler calling
   `navigator.clipboard.writeText` with the URL injected as a JSON-encoded literal. A Meet URL contains
   no apostrophes, so the injection risk is lower than the `.ics` case — but it is the same shape of
   bug, and any future `script-src` CSP would block it.

**Preserve the no-Meet path.** `safeMeet` (`:362`) is `null` whenever Google returned a `fake-` link,
and the page currently degrades to "We're still generating your video link". The new full-URL + copy
block must sit behind the same guard, or clients with no Meet link get an empty box and a copy button
that copies nothing.

---

## T3. Purpose and Drive link in the Google Calendar invite

**Purpose is already there.** Every event description begins with it —
`google-oauth.ts:113` and `:215`, `google-calendar.ts:647` and `:802`:

```ts
description: `${params.purpose || 'Intro call'}\n\nContact: ${params.email} …\n\nCancel: …`
```

So half of this ask is done. If it is not showing up in the invite, that is a different problem
(likely the bare-event retry path, which drops to a reduced payload) and worth checking against a real
invite rather than the code.

**The Drive link is genuinely absent** from all four description strings.

**The obstacle is ordering, and it is deliberate.** In the public flow the calendar event is created at
`confirm/[token].ts:166`, and the Drive folder is only ensured at `:229`. The Drive URL does not exist
yet when the event is built. That order is intentional: Drive is non-blocking (`:234-275`) so a Drive
outage cannot fail a booking, and the calendar event has to exist first so a retry cannot leak
duplicate events.

Options:

- **(a) Patch the description after the Drive step — recommended.** There is already a post-create
  `PATCH` that rewrites the description to add the Meet link (`google-oauth.ts:215`,
  `google-calendar.ts:802`), so the mechanism exists. It currently lives inside the calendar module,
  which has no access to `driveLink`, so the cleanest version is a small exported helper called from
  `confirm/[token].ts` after the Drive upsert, wrapped in try/catch so a patch failure stays
  non-blocking like the rest of the Drive path.
- **(b) The admin path can do it inline.** `manual.ts` runs Drive at step 2 and the calendar at step 3,
  so `driveLink` *is* available at create time there. That half needs no patching.

Note the invite already carries a cancel URL in the description. Adding a Drive link makes the
description four labelled lines; worth formatting deliberately rather than appending.

---

## T4. Admin-selectable site timezone

Valid, no setting exists today, and there is a clean precedent — but one dependency makes this larger
than a dropdown.

**Current state.** `google-calendar.ts:93` is a module constant:

```ts
export const TIMEZONE = 'America/New_York' // Eastern, configurable in admin later via var TIMEZONE
```

`env?.TIMEZONE` is read at `:644` as an override, but it is **declared nowhere** — not in
`wrangler.toml`, not in `.dev.vars.example`. So the override the comment advertises is unreachable in
practice, and the value is effectively hardcoded.

**The precedent is exact.** Site-level settings already live on the `pages` table, each added by its own
migration: `site_name`, `footer_tagline` (0008), `icon_url` (0009), `booking_max_per_week` (0010),
`google_tag_manager_id` (0012), `booking_min_notice_days` (0013). The admin PATCH endpoint gates them
with an allowlist at `functions/api/admin/pages/[slug].ts:13` plus per-field validation. Adding
`site_time_zone TEXT` in migration `0017` and one entry to `EDITABLE` follows the established path,
and the "Your site" block (`Admin.tsx:308`) is the right home for the control.

**Define the precedence chain explicitly**, because there are now four sources:
per-booking `time_zone` (the client's) → `pages.site_time_zone` → `env.TIMEZONE` → the
`America/New_York` constant. Rev 3's R5 deliberately made the *calendar event* use the **client's**
zone; the new admin setting should govern slot generation and admin display, and must not silently
override that.

**The hidden dependency — this is the real work.** `computeSlotsForDay` converts working hours to UTC
through two Eastern-specific helpers, `getEasternOffsetHours` (`:95-115`) and `easternWallTimeToUtcIso`
(`:117-120`), called at `:143` and `:149`. Both are written around `TIMEZONE`. If the site timezone
becomes configurable but those are left alone, working hours will keep being interpreted as Eastern
regardless of the setting — the dropdown would appear to work while producing slots at the wrong wall
time. Generalising that conversion is the bulk of T4 and is easy to miss when scoping it.

**Admin table display.** `AdminClients.tsx:1257` currently renders
`formatNiceDateTime(r.slot_start, r.time_zone)` — the **client's** zone. The ask is the admin's zone
primary with the client's mentioned, e.g. `Sep 15, 10:00 AM EDT · client 7:00 AM PDT`. `formatNiceDateTime`
already emits `timeZoneName: 'short'`, so this is a formatting change, not new plumbing. Note the
Timezone column was removed in Rev 4 precisely because the time cell carries the zone — keep it that
way and put both zones in the one cell.

---

## T5. Admin-selectable working start/end, whole-hour slots

Valid, and the whole-hour requirement is **already guaranteed** — but only as long as the start time
is itself a whole hour.

**Current state.** Working hours come from environment variables only (`slots.ts:67-73`):

```ts
start: env?.WORKING_HOURS_START || '09:00',
end:   env?.WORKING_HOURS_END   || '17:00',
days:  parseWorkingDays(env?.WORKING_DAYS),
slotMinutes: normalizeSlotMinutes(env?.SLOT_DURATION_MINUTES || '60'),
```

There is no admin control, and like `TIMEZONE` these env vars are not declared in `wrangler.toml` or
`.dev.vars.example`.

**Slot length is already locked to 60 minutes.** `normalizeSlotMinutes` (`google-calendar.ts:48-59`)
ignores its argument entirely and hard-returns `60`, with the comment "always 60 mins per requirement".
So `SLOT_DURATION_MINUTES` is inert, and every slot is an hour long.

**The whole-o'clock catch.** `computeSlotsForDay:145` iterates:

```ts
for (let mins = startMins; mins + slotMinutes <= endMins; mins += slotMinutes)
```

Slots are struck from `start`, in 60-minute steps. A start of `09:00` yields 9, 10, 11 … as intended —
but a start of `09:30` yields **9:30, 10:30, 11:30**, breaking the whole-hour rule the moment an admin
picks a non-round start. So the requirement translates to a hard constraint on the input:

- Constrain the admin control to whole hours (a `<select>` of `06:00 … 22:00`, not a free
  `<input type="time">`), **and** validate server-side in the `EDITABLE` allowlist — the UI must not be
  the only guard, matching how `booking_min_notice_days` is validated at `pages/[slug].ts:69`.
- Or snap `startMins` down to the hour inside `computeSlotsForDay`. Cheaper, but it silently ignores
  what the admin typed, which is worse UX.

Recommend the constrained select plus server validation.

**Storage and precedence.** Same treatment as T4 — `site_working_hours_start` / `_end` (and optionally
`site_working_days`) on `pages` in migration `0017`, added to `EDITABLE`, surfaced in "Your site".
One wrinkle: the existing precedence for `booking_min_notice_days` in `slots.ts:63-65` is
**env wins over DB**. If the admin setting is to be meaningful it should be the other way round, or an
env var set once during setup will silently override the admin UI forever. Pick one and apply it
consistently to notice-days, timezone and working hours.

**Validation to include:** end must be after start; both whole hours; a sane range (e.g. 06:00–22:00);
and reject a window shorter than one slot, which would otherwise produce a calendar with no
availability and no explanation.

---

## Rev 5 — suggested grouping

**PR-12a — nav (T1).** Self-contained, one file, no migration. Ship first; it is the only item where a
visitor is currently stuck on a page with no working navigation.

**PR-12b — confirm page (T2).** The `.ics` server endpoint plus the Meet-link/copy block. Decide the
no-JS-vs-inline-handler question before starting.

**PR-12c — site settings (T4 + T5).** One migration (`0017`), one allowlist change, one "Your site" UI
block, and the precedence decision. These two belong together — same table, same endpoint, same form,
and both are meaningless until the Eastern-hardcoded slot conversion is generalised.

**PR-12d — Calendar invite Drive link (T3).** Small, but touches the live Google path, which still has
no automated coverage. Verify against a real invite.

**Needs a decision:** whether env or DB wins for site settings (T4/T5); whether the copy button is
allowed to use inline JS (T2); and whether the client's timezone continues to govern the calendar
event while the admin's governs slots and display (T4).

---

# Rev 5b — "Your site" scheduling controls, UI spec (2026-08-29)

Two presentation changes to the admin settings added in Rev 5. Behaviour and storage stay the same;
only the controls change. Verified against `src/pages/Admin.tsx:427-489`.

## Current state

| Control | Today | Line |
|---|---|---|
| Working hours start | Full-width `<select>`, own grid cell, own label, 24-hour labels (`09:00`) | `:443-459` |
| Working hours end | A second full-width `<select>`, second grid cell, second label | `:460-477` |
| Working days | Free-text `EditableText` — the admin types `1,2,3,4,5` and has to know `0=Sun` | `:478-489` |

The parent is `grid grid-cols-1 lg:grid-cols-2 gap-4` (`:325`), so start and end each consume a
half-width cell and stack on narrow screens. `WHOLE_HOURS` (`:65-69`) generates 17 options from
`06:00` to `22:00`, with `value === label`.

---

## U1. Inline hour range — "9 am – 5 pm" on one line

**Ask:** collapse the two selects into a single inline range with am/pm labels and whole hours only.

**Shape:**

```
Working hours   [ 9 am ▾ ]  –  [ 5 pm ▾ ]
```

One grid cell (or `lg:col-span-2` if it should span the full width), one label, two selects and an
en-dash between them, in a `flex items-center gap-2 flex-wrap` row.

### The one thing that must not change: the stored value

Keep writing `HH:00`. Only the *option label* becomes am/pm. Three things depend on the current
format and will break silently if the value changes:

- `isWholeHourTime` in `functions/api/admin/pages/[slug].ts` validates the field on save.
- `slots.ts:95` parses with `/^(\d{1,2}):(\d{2})$/`; a non-match returns `-1` and trips the
  `SLOTS_INVALID_WORKING_HOURS` fallback, so the site would quietly serve default hours.
- Migration `0017` typed the columns `TEXT` with a `MAX_LENGTH` of 10.

So: `{ value: '09:00', label: '9 am' }`. Nothing server-side changes.

### Label mapping

`06:00 → 6 am` … `11:00 → 11 am`, `12:00 → 12 pm`, `13:00 → 1 pm` … `22:00 → 10 pm`. The two that
get written wrong are noon and midnight — `12:00` is **pm**, and `00:00` would be **12 am**. The
current range starts at 06:00 so midnight is out of scope, but if the range is ever widened the
mapping needs `h % 12 || 12`, not `h % 12`.

### Cross-field validation — worth adding while the fields are adjacent

Right now end-after-start is enforced **nowhere**. `pages/[slug].ts` validates each field
independently, and `slots.ts:98` silently falls back to 09:00–17:00 when `eM <= sM`. That fallback is
correct as a backstop but it means an admin can save `5 pm – 9 am`, see it accepted, and get default
hours with no explanation. Putting the two controls on one line makes the invalid state visible, which
is the moment to fix it:

- **UI:** filter the end select to hours strictly after the chosen start (and ≥ start + 1, since slots
  are 60 minutes). Changing start to a value ≥ end should push end forward rather than leave an
  invalid pair on screen.
- **Server:** add a relational check in `pages/[slug].ts`. It has to read the *other* field's current
  value from the row, since a PATCH may carry only one of the two — that's why this wasn't done
  originally and it is the only non-trivial part of U1.

### Save semantics

Each select currently saves on `change` independently. With an inline pair, saving start before end
can transiently persist `start >= end`. Either save both fields in one `updatePage` call when either
changes, or keep per-field saves and accept that the `slots.ts` fallback covers the window. The first
is cleaner and avoids a state the server would reject once the relational check lands.

---

## U2. Weekday toggle buttons

**Ask:** replace the comma-list text field with seven toggles, Sunday through Saturday, click to
activate and click again to deactivate.

**Shape:**

```
Working days   [S] [M] [T] [W] [T] [F] [S]
                    ▔▔▔ ▔▔▔ ▔▔▔ ▔▔▔ ▔▔▔      ← Mon–Fri active
```

**Storage is unchanged** — still the comma list `0..6` in `site_working_days`, which
`pages/[slug].ts` already validates (each entry parses to 0–6, list must not be empty) and
`parseWorkingDays` in `slots.ts` already consumes. This is purely an input-method change, so the
whole backend stays as is.

### Behaviour

- Order the buttons Sun → Sat so the visible order matches the stored `0..6`. The business runs
  Mon–Fri, so Monday-first would read more naturally — but then the on-screen order and the stored
  indices disagree, which is a debugging trap. Recommend Sun-first.
- Duplicate letters (S/T/S/T) mean the visible glyph cannot be the accessible name. Give each button
  `aria-label="Monday"` etc. and, ideally, `aria-pressed={active}` — that is what communicates
  toggle state to a screen reader, and it is the piece most often skipped.
- **Deselecting the last day:** the server rejects an empty list outright
  (`site_working_days cannot be empty if set`). Do not surface that as an error toast — instead treat
  "none selected" as a reset and send `null`, which falls back to the Mon–Fri default, with a hint
  line reading *"No days selected — using the default, Mon–Fri."* Otherwise the admin's first attempt
  to clear the field produces a server error for a reasonable action.
- **Saving:** a click per day means up to seven PATCHes. Debounce, or save on blur of the group.

### Styling — the shim constrains this

Every class must already exist in `src/index.css`, because `styles.coverage.test.ts` now fails the
build otherwise. Verified available: `min-h-11`, `w-11`, `h-11`, `rounded-full`, `bg-slate-900`,
`text-white`, `bg-white`, `border-slate-500`, `hover:bg-slate-50`, `inline-flex`, `items-center`,
`justify-center`, `gap-1`, `gap-2`, `flex-wrap`, `text-xs`, `font-semibold`. So:

- Active: `bg-slate-900 text-white`
- Inactive: `bg-white border border-slate-500 hover:bg-slate-50`
- Both: `w-11 h-11 inline-flex items-center justify-center rounded-full text-xs font-semibold`

`w-11`/`h-11` gives the 44px tap target the rest of the admin now uses. Do not reach for a colour
outside that list without adding it to `index.css` in the same change — that is exactly the failure
that made the Drive Save button invisible.

Wrap the seven in a `role="group"` with `aria-label="Working days"`, and keep the existing
`editor-chrome text-[11px] text-gray-500` caption above it, rewritten to drop the `0=Sun` explanation
that the toggles make unnecessary.

---

## Sequencing

Both are contained to `Admin.tsx` and need no migration. U1's optional server-side relational check is
the only backend touch. They belong in one PR — same settings block, same review.

**Still outstanding from the previous round:** `getTimezoneOffsetHours` returns `-0` for UTC, so
`google-calendar.test.ts:193` fails and the suite exits 1. One-line fix at `google-calendar.ts:110`
(normalise `-0` to `0`); do that before anything else lands on top of a red suite.
