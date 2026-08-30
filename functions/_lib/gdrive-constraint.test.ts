import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

// Constraint regression tests — previously claimed "Real SQLite" but only used a mock.
// Now includes both mock-based source checks (fast) and real SQLite via node:sqlite (Node 22+ / 24).
// Gap analysis replayed the statements against real SQLite and got:
//   drive-folder.ts PATCH -> NOT NULL constraint failed: client_drive_folders.email (19)
//   manual.ts INSERT -> NOT NULL constraint failed: client_drive_folders.email (19)
// These tests prevent re-introducing those exact bugs.

// Synchronous detection for skipIf — node:sqlite is Node 22+; Node 20 throws.
const require = createRequire(import.meta.url)
let hasNodeSqlite = false
try {
  require('node:sqlite')
  hasNodeSqlite = true
} catch {
  hasNodeSqlite = false
}

describe('GDrive stack gap — B1: client_drive_folders NOT NULL (source + mock)', () => {
  const migration = readFileSync(join(__dirname, '../../migrations/0014_client_drive_folders.sql'), 'utf-8')

  it('migration declares NOT NULL for email and folder_id', () => {
    expect(migration).toContain('email TEXT NOT NULL')
    expect(migration).toContain('folder_id TEXT NOT NULL')
    expect(migration).toContain('folder_url TEXT NOT NULL')
  })

  // Mock D1 that enforces NOT NULL constraints like real SQLite
  function makeRealishDb() {
    const requiredCols = ['contact_id', 'email', 'year', 'folder_id', 'folder_url']
    const rows: any[] = []
    return {
      prepare(sql: string) {
        const normalized = sql.toLowerCase()
        const isInsert = normalized.includes('client_drive_folders') && (normalized.includes('insert into') || normalized.includes('insert or replace'))
        const colMatch = /client_drive_folders\s*\(([^)]+)\)/i.exec(sql)
        const cols = colMatch ? colMatch[1].split(',').map((c) => c.trim().toLowerCase()) : []
        return {
          bind(...binds: any[]) {
            return {
              run: async () => {
                if (isInsert && cols.length > 0) {
                  // Enforce NOT NULL like SQLite does before conflict resolution
                  for (const required of requiredCols) {
                    if (!cols.includes(required)) {
                      throw new Error(`NOT NULL constraint failed: client_drive_folders.${required} (19)`)
                    }
                  }
                  // Also enforce that bound values for required cols are not null/undefined
                  for (let i = 0; i < cols.length; i++) {
                    const col = cols[i]
                    if (requiredCols.includes(col) && (binds[i] == null || binds[i] === '')) {
                      throw new Error(`NOT NULL constraint failed: client_drive_folders.${col} (19)`)
                    }
                  }
                }
                return {}
              },
              first: async () => ({ id: 'c1', email: 'test@example.com', drive_folder_id: null, drive_is_manual: 0 }),
              all: async () => ({ results: [] }),
            }
          },
        }
      },
      // eslint-disable-next-line @typescript-eslint/no-unused-vars
      _rows: rows,
    }
  }

  it('drive-folder.ts fixed upsert binds all NOT NULL columns (client_drive_folders)', async () => {
    const src = readFileSync(join(__dirname, '../api/admin/clients/drive-folder.ts'), 'utf-8')
    // Extract the year-level INSERT statement
    const insertMatch = src.match(/INSERT INTO client_drive_folders \(([^)]+)\)[\s\S]*?\.bind\(([^)]+)\)/) as any
    expect(insertMatch).not.toBeNull()
    const colList = insertMatch[1].toLowerCase()
    for (const required of ['contact_id', 'email', 'year', 'folder_id', 'folder_url']) {
      expect(colList).toContain(required)
    }

    // Simulate running against realish DB that enforces NOT NULL
    const db = makeRealishDb() as any
    // Should not throw for fixed code pattern (includes email)
    await expect(
      db
        .prepare(
          `INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, is_manual) VALUES (?, ?, ?, ?, ?, 1)`
        )
        .bind('c1', 'test@example.com', 2026, 'fid', 'https://drive.google.com/drive/folders/fid')
        .run()
    ).resolves.toBeDefined()
  })

  it('manual.ts fixed upsert binds all NOT NULL columns', async () => {
    const src = readFileSync(join(__dirname, '../api/admin/bookings/manual.ts'), 'utf-8')
    // Should NOT contain buggy `INSERT OR REPLACE INTO client_drive_folders (contact_id, folder_url, year)` (missing email+folder_id)
    expect(src).not.toMatch(/INSERT OR REPLACE INTO client_drive_folders\s*\(\s*contact_id\s*,\s*folder_url\s*,\s*year\s*\)/)
    // Fixed version includes email, folder_id
    expect(src).toMatch(/INSERT INTO client_drive_folders.*email.*folder_id/s)

    const db = makeRealishDb() as any
    // Old buggy statement should fail
    await expect(
      db
        .prepare(`INSERT OR REPLACE INTO client_drive_folders (contact_id, folder_url, year) VALUES (?, ?, ?)`)
        .bind('c1', 'https://drive.google.com/drive/folders/fid', 2026)
        .run()
    ).rejects.toThrow(/NOT NULL constraint failed/)

    // Fixed statement should pass
    await expect(
      db
        .prepare(
          `INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, parent_folder_id, parent_folder_url) VALUES (?, ?, ?, ?, ?, ?, ?)`
        )
        .bind('c1', 'test@example.com', 2026, 'yfid', 'https://drive.google.com/drive/folders/yfid', 'efid', 'https://drive.google.com/drive/folders/efid')
        .run()
    ).resolves.toBeDefined()
  })

  it('confirm upsert refreshes all folder ids (M10)', () => {
    const src = readFileSync(join(__dirname, '../api/booking/confirm/[token].ts'), 'utf-8')
    // Must update folder_id, parent_folder_id, parent_folder_url on conflict, not just folder_url
    expect(src).toMatch(/ON CONFLICT.*DO UPDATE SET[\s\S]*folder_id/)
    expect(src).toMatch(/ON CONFLICT.*DO UPDATE SET[\s\S]*parent_folder_id/)
    expect(src).toMatch(/ON CONFLICT.*DO UPDATE SET[\s\S]*parent_folder_url/)
  })
})

describe('GDrive — google-drive.ts H1 regression guard', () => {
  const src = readFileSync(join(__dirname, 'google-drive.ts'), 'utf-8')

  it('searchFolder escapes single quotes and encodes whole q, not name alone (H1)', () => {
    // Must NOT do `name='${encodeURIComponent(name)}'` (bug: asks for %40 folder)
    expect(src).not.toMatch(/name='\$\{encodeURIComponent\(name\)\}/)
    // Must escape single quote in name
    expect(src).toMatch(/replace.*'.*\\'/)
    // Must encode entire q
    expect(src).toMatch(/encodeURIComponent\(q\)/)
    expect(src).toContain('fields=files(id,name)')
  })

  it('has null guards after createFolder (H2)', () => {
    expect(src).toMatch(/if \(!emailFolder/)
    expect(src).toMatch(/if \(!yearFolder/)
    expect(src).toMatch(/Failed to ensure email folder/)
    expect(src).toMatch(/Failed to ensure year folder/)
  })

  it('discards live path when source is stub / token empty (H3)', () => {
    expect(src).toMatch(/source === 'stub'/)
    expect(src).toMatch(/!token/)
  })

  it('ensurePermission wraps in try/catch and skips owner (H4)', () => {
    expect(src).toMatch(/try\s*\{/)
    expect(src).toMatch(/skippedOwner|owner/i)
    expect(src).toMatch(/alreadyShared/)
  })

  it('calls env getters, not direct env.GOOGLE_DRIVE_ROOT_FOLDER_ID (H5)', () => {
    // Ensure getDriveRootFolderId is used for root resolution
    expect(src).toMatch(/getDriveRootFolderId/)
    expect(src).toMatch(/getDriveOwnerEmail/)
  })

  it('stub email folder id is stable across years (L8)', async () => {
    const { ensureClientDriveFolder } = await import('./google-drive')
    const env = { ENVIRONMENT: 'local' } as any
    const r2025 = await ensureClientDriveFolder(env, 'same@example.com', 2025)
    const r2026 = await ensureClientDriveFolder(env, 'same@example.com', 2026)
    // Email folder stable so reuse can be detected
    expect(r2025.emailFolderId).toBe(r2026.emailFolderId)
    expect(r2025.yearFolderId).not.toBe(r2026.yearFolderId)
  })
})

describe('Client portal — B2 regression guards', () => {
  const lookupSrc = readFileSync(join(__dirname, '../api/client-portal/lookup.ts'), 'utf-8')
  const portalSrc = readFileSync(join(__dirname, '../../src/pages/ClientPortal.tsx'), 'utf-8')

  it('lookup uses correct Turnstile secret name and checks result.ok (B2 backend)', () => {
    expect(lookupSrc).toContain('getTurnstileSecret')
    expect(lookupSrc).toContain('TURNSTILE_SECRET_KEY')
    expect(lookupSrc).not.toContain('TURNSTILE_SECRET`') // buggy single name without KEY
    expect(lookupSrc).toMatch(/result\.ok|isTurnstileValid\.ok|result\.ok/)
    // Passes env for fallback
    expect(lookupSrc).toMatch(/verifyTurnstile\(.*env\)/)
  })

  it('ClientPortal uses window.TURNSTILE_SITE_KEY and has retry + expired-callback (B2 frontend)', () => {
    expect(portalSrc).toContain('TURNSTILE_SITE_KEY')
    expect(portalSrc).not.toContain('VITE_TURNSTILE_SITE_KEY')
    expect(portalSrc).toMatch(/expired-callback/)
    expect(portalSrc).toMatch(/setTimeout|retry/i)
    expect(portalSrc).toMatch(/fake-token-for-test/)
  })
})

describe('Search — M1/M2/F5 regression guards', () => {
  const src = readFileSync(join(__dirname, '../api/admin/clients/search.ts'), 'utf-8')

  it('does not join client_drive_folders without year correlation (M1)', () => {
    // Old buggy join: `LEFT JOIN client_drive_folders cdf ON cdf.contact_id = c.id` without year
    // New implementation uses separate queries
    expect(src).not.toMatch(/LEFT JOIN client_drive_folders cdf ON cdf\.contact_id = c\.id\s*\n/)
    expect(src).toMatch(/year_folders|folderMap|clients/)
  })

  it('date filter narrows meetings only, not clients (M2)', () => {
    // Should NOT have `AND datetime(b.slot_start)` in the contacts query when join-based
    // New version builds meetingQuery separately
    expect(src).toMatch(/meetingQuery/)
  })

  it('supports Drive URL search via extractFolderId (F5)', () => {
    expect(src).toContain('extractFolderId')
    expect(src).toMatch(/drive_folder_id|folder_id/)
  })
})

describe('send-email — F2 + M8 contract', () => {
  const src = readFileSync(join(__dirname, '../api/admin/clients/send-email.ts'), 'utf-8')
  it('accepts booking_ids and validates ownership + returns full contract', () => {
    expect(src).toContain('booking_ids')
    expect(src).toMatch(/booking_ids must belong/)
    expect(src).toContain('sentTo')
    expect(src).toContain('meetingsCount')
    expect(src).toContain('driveLink')
  })
})

describe('GDrive — real SQLite constraint guard (Node 24)', () => {
  // Bumped tests image to node:24-alpine so this runs in CI gate. Still use skipIf so local Node 20 shows skipped, not green.
  const itReal = hasNodeSqlite ? it : it.skip
  itReal('real SQLite rejects buggy inserts missing NOT NULL columns', async () => {
    // Use node:sqlite — Node 22+ / 24 built-in
    let DatabaseSync: any
    try {
      // @ts-ignore — node:sqlite types missing in @types/node@20
      const mod = await import('node:sqlite' as any)
      DatabaseSync = (mod as any).DatabaseSync
    } catch (e: any) {
      // Should never hit when hasNodeSqlite true and container bumped to 24, but keep loud log.
      console.log(`!!! REAL_SQLITE_UNAVAILABLE ${e?.message} — needs Node 22+/24-alpine, hasNodeSqlite=${hasNodeSqlite}`)
      throw new Error(`node:sqlite unavailable in this runtime — bump container to node:22-alpine/node:24-alpine (hasNodeSqlite=${hasNodeSqlite})`)
    }
    if (!hasNodeSqlite || !DatabaseSync) {
      console.log('!!! REAL_SQLITE_SKIP hasNodeSqlite false — marking skipped via it.skip, not silent green')
      return
    }
    const db = new DatabaseSync(':memory:')
    // Minimal contacts for FK
    db.exec(`
      CREATE TABLE contacts (
        id TEXT PRIMARY KEY,
        email TEXT,
        first_name TEXT,
        last_name TEXT,
        phone TEXT,
        drive_folder_url TEXT,
        drive_folder_id TEXT,
        drive_is_manual INTEGER,
        created_at TEXT
      );
    `)
    const migration = readFileSync(join(__dirname, '../../migrations/0014_client_drive_folders.sql'), 'utf-8')
    const createTableSql = migration.split('CREATE INDEX')[0] // only first CREATE TABLE, ignore bookings ALTERs that need bookings table
    db.exec(createTableSql)
    db.exec(`INSERT INTO contacts (id, email) VALUES ('c1', 'test@example.com')`)
    db.exec(`INSERT INTO contacts (id, email) VALUES ('c2', 'test2@example.com')`)

    // Old buggy pattern from manual.ts: only contact_id, folder_url, year — missing email, folder_id
    let threw = false
    try {
      db.exec(`INSERT INTO client_drive_folders (contact_id, folder_url, year) VALUES ('c1', 'https://drive.google.com/drive/folders/fid', 2026)`)
    } catch (e: any) {
      threw = true
      expect(e.message).toMatch(/NOT NULL constraint failed/i)
      expect(e.message).toMatch(/email/i)
    }
    expect(threw).toBe(true)

    // Old buggy pattern from drive-folder.ts: missing email column (contact_id, year, folder_url, folder_id, is_manual)
    threw = false
    try {
      db.exec(`INSERT INTO client_drive_folders (contact_id, year, folder_url, folder_id, is_manual) VALUES ('c2', 2026, 'https://drive.google.com/drive/folders/abc', 'abc', 1)`)
    } catch (e: any) {
      threw = true
      expect(e.message).toMatch(/NOT NULL constraint failed/i)
      expect(e.message).toMatch(/email/i)
    }
    expect(threw).toBe(true)

    // Fixed 5-column bind (email + folder_id + folder_url) should succeed
    expect(() => {
      db.exec(`INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, is_manual) VALUES ('c1', 'test@example.com', 2026, 'fid', 'https://drive.google.com/drive/folders/fid', 1)`)
    }).not.toThrow()

    // Even better 7-column (with parent ids) should succeed on new year
    expect(() => {
      db.exec(`INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, parent_folder_id, parent_folder_url) VALUES ('c1', 'test@example.com', 2027, 'yfid', 'https://drive.google.com/drive/folders/yfid', 'efid', 'https://drive.google.com/drive/folders/efid')`)
    }).not.toThrow()

    db.close()
  })
})
