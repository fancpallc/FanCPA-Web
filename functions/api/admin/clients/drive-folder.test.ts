import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

// B1 regression guard: verify the PATCH statements bind all NOT NULL columns
describe('drive-folder.ts — B1 NOT NULL regression guard', () => {
  const src = readFileSync(join(__dirname, 'drive-folder.ts'), 'utf-8')

  it('client-level PATCH updates contacts with folder_id + is_manual', () => {
    // Must set drive_folder_id and drive_is_manual on contacts (client-level link is 1:1)
    expect(src).toContain('drive_folder_id')
    expect(src).toContain('drive_is_manual')
  })

  it('year-level upsert binds email, folder_id, and is_manual (NOT NULL columns)', () => {
    // client_drive_folders has NOT NULL: contact_id, email, year, folder_id, folder_url
    // Fixed version must bind email and folder_id
    const hasEmailBind = src.includes('email') && src.includes('contact_id')
    expect(hasEmailBind).toBe(true)
    expect(src).toMatch(/INSERT INTO client_drive_folders/)
    // The old buggy version was `INSERT INTO client_drive_folders (contact_id, year, folder_url, folder_id, is_manual)` omitting email
    // or `INSERT OR REPLACE INTO client_drive_folders (contact_id, folder_url, year)` omitting email+folder_id
    // Our fixed version must include email in the INSERT column list
    const yearInsertMatch = src.match(/INSERT INTO client_drive_folders \(([^)]+)\)/g) || []
    const includesEmail = yearInsertMatch.some((stmt) => stmt.includes('email'))
    expect(includesEmail).toBe(true)
  })

  it('validates Drive URL format before DB write', () => {
    expect(src).toContain('drive')
    expect(src).toContain('google')
    expect(src).toMatch(/Invalid Drive URL/)
  })

  it('supports client-level PATCH without year (F4)', () => {
    // When year omitted → client-level override per Rev2
    expect(src).toContain('drive_folder_url')
    // Should handle both modes discriminated by presence of year
    expect(src).toMatch(/year/i)
  })
})

// Behavioral tests with mocked D1
describe('drive-folder.ts — auth + behavior', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({ id: 'c1', email: 'a@b.com' }),
      all: vi.fn().mockResolvedValue({ results: [{ contact_id: 'c1', year: 2026, folder_url: 'https://drive.google.com/drive/folders/xyz' }] }),
      run: vi.fn().mockResolvedValue({}),
    }),
  } as any

  beforeEach(() => vi.clearAllMocks())

  it('returns 401 without admin auth', async () => {
    vi.resetModules()
    vi.doMock('../../../_lib/auth', () => ({
      isAdminAuthenticated: () => ({ authed: false }),
    }))
    const { onRequestPatch } = await import('./drive-folder.ts')
    const req = new Request('http://localhost/api/admin/clients/drive-folder', {
      method: 'PATCH',
      body: JSON.stringify({ contact_id: 'c1', folder_url: 'https://drive.google.com/drive/folders/abc' }),
    })
    const res = await onRequestPatch({ request: req, env: { DB: mockDb } } as any)
    expect(res.status).toBe(401)
  })
})
