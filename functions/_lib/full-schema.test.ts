import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync } from 'node:fs'
import { join } from 'node:path'
import { createRequire } from 'node:module'

/**
 * Full migration chain — real SQLite schema drift guard (P0/P1 fix, revised)
 *
 * Why: B1 was "every client_drive_folders write violates NOT NULL against real SQLite,
 * but mocks green". S7 was same class for bookings.deleted_reason — search.ts swallowed
 * missing-column error to empty list, blanking admin table.
 *
 * Drift-proof (fixes review "guards a snapshot, not drift"):
 * - Reads SQL out of module text like gdrive-constraint.test.ts:77 does via
 *   `src.match(/INSERT INTO .../)` — but only from `.prepare()` args so comments like
 *   "// Insert into bookings (only after Google 200)" cannot fake a column list. If someone
 *   edits search.ts:110 to SELECT a new column and forgets migration 0016, extraction reads
 *   the new column from actual file and SQLite throws "no such column".
 * - Replays real app INSERTs (not just SELECTs/UPDATEs) — B1 class. Covers
 *   booking.ts pending_bookings, confirm/[token].ts bookings, manual.ts bookings, contacts.
 *
 * Node version: Docker node:24-alpine, CI fine. Local Node 20 lacks node:sqlite (Node 22+).
 * Previously it.skip disappeared silently. Now logs !!! skip reason loudly (review point 3).
 */

const require = createRequire(import.meta.url)
let hasNodeSqlite = false
try {
  require('node:sqlite')
  hasNodeSqlite = true
} catch {
  hasNodeSqlite = false
}

if (!hasNodeSqlite) {
  // eslint-disable-next-line no-console
  console.log('!!! FULL_SCHEMA_GUARD_SKIPPED node:sqlite unavailable — need Node 22+/24-alpine, local Node 20 loses this check (see gdrive-constraint.test.ts)')
  // eslint-disable-next-line no-console
  console.warn('!!! FULL_SCHEMA_GUARD_SKIPPED — guard disabled on this Node version, Docker CI still covers it')
}

function getPrepareSqls(src: string, mustContain?: string): string[] {
  const out: string[] = []
  const patterns = [
    /\.prepare\s*\(\s*`([\s\S]*?)`\s*\)/g,
    /\.prepare\s*\(\s*'([\s\S]*?)'\s*\)/g,
    /\.prepare\s*\(\s*"([\s\S]*?)"\s*\)/g,
  ]
  for (const pat of patterns) {
    for (const m of src.matchAll(pat)) {
      const sql = m[1]
      if (!mustContain || sql.toUpperCase().includes(mustContain.toUpperCase())) out.push(sql)
    }
  }
  return out
}

function extractInsertsFromPrepares(sqls: string[]): { table: string; cols: string[]; raw: string }[] {
  const out: { table: string; cols: string[]; raw: string }[] = []
  const re = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+([a-z_]+)\s*\(\s*([^)]+?)\s*\)/i
  for (const sql of sqls) {
    const m = sql.match(re)
    if (!m) continue
    const table = m[1]
    const cols = m[2]
      .split(',')
      .map((c) => c.trim().replace(/["'`]/g, '').split(/\s+/)[0])
      .filter(Boolean)
    out.push({ table, cols, raw: sql.slice(0, 400) })
  }
  return out
}

function extractSelectsForTable(src: string, table: string): { colsRaw: string; raw: string }[] {
  const out: { colsRaw: string; raw: string }[] = []
  // Only parse SELECTs that appear inside .prepare() strings first — more robust
  const prepareSqls = getPrepareSqls(src, `FROM ${table}`)
  const re = new RegExp(`SELECT\\s+((?:(?!SELECT|FROM)[\\s\\S])*?)\\s+FROM\\s+${table}\\b`, 'i')
  for (const sql of prepareSqls) {
    const m = sql.match(re)
    if (!m) continue
    const colsRaw = m[1].replace(/\$\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim()
    out.push({ colsRaw, raw: sql.slice(0, 500) })
  }
  // Fallback for queries built via let/var = `SELECT ...` then prepare(variable) — e.g., search.ts meetingQuery
  // Use a regex that forbids nested SELECT/FROM in cols to avoid crossing to DELETE FROM or other clause (previous bug with DELETE FROM pending_bookings)
  const directRe = new RegExp(`SELECT\\s+((?:(?!SELECT|FROM)[\\s\\S])*?)\\s+FROM\\s+${table}\\b`, 'gi')
  let dm: RegExpExecArray | null
  while ((dm = directRe.exec(src)) !== null) {
    const colsRaw = dm[1].replace(/\$\{[^}]+\}/g, '').replace(/\s+/g, ' ').trim()
    if (colsRaw.includes("').") || colsRaw.includes('const ') || colsRaw.includes('console.log') || colsRaw.includes('}')) continue
    // Skip if cols contains FROM or other SQL keywords that indicate we crossed clause (previous bug: cols included "FROM contacts WHERE")
    if (/\bFROM\b/i.test(colsRaw)) continue
    if (out.some((o) => o.colsRaw === colsRaw)) continue
    out.push({ colsRaw, raw: dm[0].slice(0, 500) })
  }
  return out
}

function splitColsRespectingParen(s: string): string[] {
  const parts: string[] = []
  let cur = ''
  let depth = 0
  for (let i = 0; i < s.length; i++) {
    const ch = s[i]
    if (ch === '(') depth++
    if (ch === ')') depth = Math.max(0, depth - 1)
    if (ch === ',' && depth === 0) {
      parts.push(cur)
      cur = ''
    } else cur += ch
  }
  if (cur) parts.push(cur)
  return parts
}

function parseColExpr(expr: string): { base: string | null; prefix: string | null; isWildcard: boolean } {
  let e = expr.trim()
  if (!e) return { base: null, prefix: null, isWildcard: false }
  if (e.startsWith('?')) return { base: null, prefix: null, isWildcard: false }
  if (e.includes('${')) return { base: null, prefix: null, isWildcard: false }
  // alias: "id as booking_id" -> "id"
  e = e.split(/\s+as\s+/i)[0].trim()
  // wildcard b.* or *
  if (e === '*') return { base: null, prefix: null, isWildcard: true }
  if (e.includes('.*')) {
    const pref = e.split('.*')[0].trim().replace(/["'`\[\]]/g, '')
    return { base: null, prefix: pref || null, isWildcard: true }
  }
  if (e.includes('(')) return { base: null, prefix: null, isWildcard: false }
  let prefix: string | null = null
  let base = e
  if (e.includes('.')) {
    const parts = e.split('.')
    prefix = parts[0].trim().replace(/["'`\[\]]/g, '')
    base = parts[parts.length - 1].trim().replace(/["'`\[\]]/g, '')
  } else {
    base = base.replace(/["'`\[\]]/g, '').trim()
  }
  if (base === '*' || base === '') return { base: null, prefix, isWildcard: false }
  if (!/^[a-z_][a-z0-9_]*$/i.test(base)) return { base: null, prefix, isWildcard: false }
  return { base, prefix, isWildcard: false }
}

function prefixMatchesTable(prefix: string | null, table: string): boolean {
  if (!prefix) return true // no prefix → assume main table for simple queries
  const p = prefix.toLowerCase()
  const t = table.toLowerCase()
  if (p === t) return true
  if (t === 'bookings' && (p === 'b' || p === 'b2')) return true
  if (t === 'contacts' && p === 'c') return true
  if (t === 'client_drive_folders' && (p === 'cdf' || p === 'x')) return true
  if (t === 'pending_bookings' && p === 'pb') return true
  // For join queries where SELECT mixes tables, prefix mismatch means column belongs to other table
  return false
}

function baseColFromExpr(expr: string): string | null {
  return parseColExpr(expr).base
}

describe('Full migration chain — real SQLite schema drift guard (P0)', () => {
  const itReal = hasNodeSqlite ? it : it.skip

  itReal('applies all migrations and app SQL extracted from module text succeeds (drift-proof + INSERT coverage)', async () => {
    let DatabaseSync: any
    try {
      // @ts-ignore
      const mod = await import('node:sqlite' as any)
      DatabaseSync = (mod as any).DatabaseSync
    } catch {
      throw new Error('node:sqlite unavailable — need Node 22+/24-alpine')
    }
    const db = new DatabaseSync(':memory:')

    const migrationsDir = join(__dirname, '../../migrations')
    const files = readdirSync(migrationsDir)
      .filter((f) => f.endsWith('.sql'))
      .sort()
    for (const file of files) {
      const sql = readFileSync(join(migrationsDir, file), 'utf-8')
      try {
        db.exec(sql)
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.log(`!!! MIGRATION_APPLY_FAILED file=${file} error=${e?.message}`)
        throw e
      }
    }

    function tableCols(table: string): string[] {
      try {
        const stmt = db.prepare(`SELECT name FROM pragma_table_info('${table}')`)
        const rows = stmt.all() as any[]
        return rows.map((r: any) => r.name)
      } catch {
        return []
      }
    }

    const bookingsCols = tableCols('bookings')
    const contactsCols = tableCols('contacts')
    const cdfCols = tableCols('client_drive_folders')
    const pendingCols = tableCols('pending_bookings')

    expect(bookingsCols, 'bookings table missing').toContain('id')
    expect(bookingsCols).toContain('deleted_reason')
    expect(bookingsCols).toContain('updated_at')
    expect(bookingsCols).toContain('cancelled_at')
    expect(bookingsCols).toContain('cancelled_by')
    expect(bookingsCols).toContain('cancel_notified')
    expect(bookingsCols).toContain('deleted_at')
    expect(contactsCols).toContain('updated_at')
    expect(cdfCols).toContain('email')
    expect(cdfCols).toContain('folder_id')
    expect(pendingCols).toContain('confirm_token')

    // Seed
    expect(() => {
      db.exec(
        `INSERT INTO contacts (id, first_name, last_name, email, phone, drive_folder_url, drive_folder_id, drive_is_manual, created_at, updated_at) VALUES ('c1', 'Jane', 'Doe', 'jane@example.com', '+1555', 'https://drive.google.com/drive/folders/root1234567890', 'root1234567890', 0, datetime('now'), datetime('now'))`,
      )
    }).not.toThrow()
    expect(() => {
      db.exec(
        `INSERT INTO client_drive_folders (contact_id, email, year, folder_id, folder_url, parent_folder_id, parent_folder_url, is_manual, created_at, updated_at) VALUES ('c1', 'jane@example.com', 2026, 'year1234567890', 'https://drive.google.com/drive/folders/year1234567890', 'root1234567890', 'https://drive.google.com/drive/folders/root1234567890', 1, datetime('now'), datetime('now'))`,
      )
    }).not.toThrow()

    let seq = 0
    function dummyFor(col: string, table: string): number | string {
      seq++
      const lc = col.toLowerCase()
      if (lc === 'id') return `${table}_${seq}_${Date.now()}`
      if (lc === 'contact_id') return 'c1'
      // Use unique year per insert to avoid UNIQUE(contact_id,year) collision with seeded 2026
      if (lc === 'year') return 2026 + seq
      if (lc === 'is_manual' || lc === 'drive_is_manual' || lc === 'cancel_notified') return lc === 'cancel_notified' ? 0 : 1
      if (lc.includes('email')) return `test${seq}@example.com`
      if (lc === 'folder_id') return `folder_${seq}_1234567890`
      if (lc === 'parent_folder_id') return `parent_${seq}_1234567890`
      if (lc === 'drive_folder_id') return `drive_${seq}_1234567890`
      if (lc.includes('folder_url') || lc.includes('parent_folder_url') || lc.includes('drive_folder_url')) return `https://drive.google.com/drive/folders/f_${seq}_1234567890`
      if (lc === 'first_name') return 'Jane'
      if (lc === 'last_name') return 'Doe'
      if (lc === 'phone') return '+1555'
      if (lc === 'purpose') return 'Test purpose clamp'
      if (lc === 'slot_date') return '2026-09-15'
      if (lc === 'slot_start') return new Date(Date.now() + 86400000 + seq * 1000).toISOString()
      if (lc === 'slot_end') return new Date(Date.now() + 90000000 + seq * 1000).toISOString()
      if (lc === 'confirm_token') return `confirm_${seq}_${Date.now()}`
      if (lc === 'cancel_token') return `cancel_${seq}_${Date.now()}`
      if (lc === 'expires_at') return new Date(Date.now() + 3600000).toISOString()
      if (lc === 'time_zone') return 'America/New_York'
      if (lc === 'calendar_event_id') return `cal_${seq}`
      if (lc === 'meet_link') return `https://meet.google.com/abc-defg-${seq}`
      if (lc === 'status') return 'confirmed'
      if (lc === 'created_at' || lc === 'updated_at' || lc === 'cancelled_at' || lc === 'deleted_at') return new Date().toISOString()
      if (lc === 'cancelled_by' || lc === 'deleted_reason') return 'test_guard'
      return `val_${seq}`
    }

    function buildInsertSql(table: string, cols: string[]): string {
      const vals = cols.map((c) => dummyFor(c, table))
      const sqlVals = vals
        .map((v) => (typeof v === 'number' ? String(v) : `'${String(v).replace(/'/g, "''")}'`))
        .join(', ')
      // Use OR REPLACE to avoid UNIQUE(contact_id,year) / PK collisions masking NOT NULL / missing-column errors
      return `INSERT OR REPLACE INTO ${table} (${cols.join(', ')}) VALUES (${sqlVals})`
    }

    const appFiles = [
      join(__dirname, '../api/booking.ts'),
      join(__dirname, '../api/booking/confirm/[token].ts'),
      join(__dirname, '../api/admin/bookings/manual.ts'),
      join(__dirname, '../api/admin/clients/drive-folder.ts'),
      join(__dirname, '../api/admin/clients/search.ts'),
      join(__dirname, '../api/admin/bookings/[id].ts'),
      join(__dirname, '../api/cancel/[token].ts'),
    ]

    const allInserts: { file: string; table: string; cols: string[] }[] = []
    for (const f of appFiles) {
      let src = ''
      try {
        src = readFileSync(f, 'utf-8')
      } catch {
        continue
      }
      const prepareSqls = getPrepareSqls(src, 'INSERT INTO')
      const ins = extractInsertsFromPrepares(prepareSqls)
      for (const i of ins) {
        if (!['bookings', 'contacts', 'client_drive_folders', 'pending_bookings'].includes(i.table)) continue
        allInserts.push({ file: f.split('/').pop() || f, table: i.table, cols: i.cols })
      }
    }

    const insertTables = allInserts.map((i) => i.table)
    expect(insertTables, 'should find pending_bookings INSERT from booking.ts').toContain('pending_bookings')
    expect(insertTables, 'should find bookings INSERT from confirm/[token].ts and manual.ts').toContain('bookings')
    expect(insertTables, 'should find contacts INSERT').toContain('contacts')
    expect(insertTables, 'should find client_drive_folders INSERT').toContain('client_drive_folders')

    // B1: client_drive_folders must include NOT NULL cols
    const cdfInserts = allInserts.filter((i) => i.table === 'client_drive_folders')
    for (const ins of cdfInserts) {
      const lower = ins.cols.map((c) => c.toLowerCase())
      expect(lower, `client_drive_folders INSERT from ${ins.file} missing email (B1)`).toContain('email')
      expect(lower, `client_drive_folders INSERT from ${ins.file} missing folder_id (B1)`).toContain('folder_id')
      expect(lower, `client_drive_folders INSERT from ${ins.file} missing folder_url`).toContain('folder_url')
      expect(lower, `client_drive_folders INSERT from ${ins.file} missing contact_id`).toContain('contact_id')
      expect(lower, `client_drive_folders INSERT from ${ins.file} missing year`).toContain('year')
    }

    // Replay distinct INSERT column sets (INSERT-time failure = B1, plus no such column drift)
    const seen = new Set<string>()
    for (const ins of allInserts) {
      const key = `${ins.table}:${[...ins.cols].sort().join(',')}`
      if (seen.has(key)) continue
      seen.add(key)
      const actual = tableCols(ins.table)
      for (const c of ins.cols) {
        expect(actual, `INSERT from ${ins.file} references ${ins.table}.${c} but migrated schema missing it (drift)`).toContain(c.toLowerCase())
      }
      const sql = buildInsertSql(ins.table, ins.cols)
      try {
        db.exec(sql)
      } catch (e: any) {
        // eslint-disable-next-line no-console
        console.log(`!!! INSERT_DRIFT_FAILED file=${ins.file} table=${ins.table} cols=${ins.cols.join(',')} sql=${sql.slice(0, 300)} error=${e?.message}`)
        throw new Error(`INSERT drift for ${ins.table} from ${ins.file}: ${e?.message}. SQL: ${sql}`)
      }
    }

    // SELECT drift for all tables — columns referenced must exist (drift-proof, reads from module text)
    for (const f of appFiles) {
      let src = ''
      try {
        src = readFileSync(f, 'utf-8')
      } catch {
        continue
      }
      for (const table of ['bookings', 'contacts', 'client_drive_folders', 'pending_bookings']) {
        const actual = tableCols(table)
        if (!actual.length) continue
        const selects = extractSelectsForTable(src, table)
        for (const sel of selects) {
          const parts = splitColsRespectingParen(sel.colsRaw)
          const belongingBases: string[] = []
          let hasWildcardForTable = false
          for (const part of parts) {
            const { base, prefix, isWildcard } = parseColExpr(part)
            if (isWildcard) {
              if (prefixMatchesTable(prefix, table)) hasWildcardForTable = true
              continue
            }
            if (!base) continue
            if (!prefixMatchesTable(prefix, table)) continue // column belongs to other table in JOIN, skip for this table
            belongingBases.push(base)
            expect(actual, `SELECT from ${f.split('/').pop()} references ${table}.${base} but migrated schema missing it (drift). SELECT: ${sel.raw.slice(0, 200)}`).toContain(base)
          }
          // Exec check only for columns that actually belong to this table
          if (!belongingBases.length && !hasWildcardForTable) continue
          const execCols = hasWildcardForTable ? '*' : belongingBases.join(', ')
          try {
            db.exec(`SELECT ${execCols} FROM ${table} LIMIT 0`)
          } catch (e: any) {
            // eslint-disable-next-line no-console
            console.log(`!!! SELECT_EXEC_FAILED file=${f.split('/').pop()} table=${table} execCols=${execCols.slice(0, 300)} error=${e?.message} raw=${sel.raw.slice(0, 300)}`)
            throw new Error(`SELECT exec drift for ${table} from ${f}: ${e?.message}. ExecCols: ${execCols}`)
          }
        }
      }
    }

    expect(() => {
      db.exec(`SELECT deleted_reason, deleted_at, cancelled_at, cancelled_by, updated_at, cancel_notified FROM bookings LIMIT 0`)
    }).not.toThrow()
    expect(() => {
      db.exec(`SELECT updated_at FROM contacts LIMIT 0`)
    }).not.toThrow()
    expect(() => {
      db.exec(`SELECT email, folder_id, folder_url, contact_id, year FROM client_drive_folders LIMIT 0`)
    }).not.toThrow()

    db.close()
  })
})
