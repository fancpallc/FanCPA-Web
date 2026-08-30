import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockAuthState = { authed: true, email: 'admin@test.com' } as any

vi.mock('../../../_lib/auth', async () => {
  const actual = (await vi.importActual('../../../_lib/auth')) as any
  return {
    ...actual,
    isAdminAuthenticated: vi.fn(() => mockAuthState),
  }
})

const mockDb = {
  prepare: vi.fn(),
}

vi.mock('../../../_lib/google-drive', async () => {
  const actual = (await vi.importActual('../../../_lib/google-drive')) as any
  return {
    ...actual,
    extractFolderId: (url: string) => {
      const m = /\/folders\/([A-Za-z0-9-_]+)/.exec(url)
      return m?.[1] || null
    },
  }
})

import { onRequestGet } from './search'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthState = { authed: true, email: 'admin@test.com' } as any
  mockDb.prepare.mockReturnValue({
    bind: vi.fn().mockReturnThis(),
    all: vi.fn().mockResolvedValue({ results: [] }),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({}),
  } as any)
  // restore auth fn to read mutable state, since clearAllMocks wipes impl
  import('../../../_lib/auth').then(mod => {
    const fn = (mod as any).isAdminAuthenticated
    if (fn?.mockImplementation) fn.mockImplementation(() => mockAuthState)
  })
})

describe('GET /api/admin/clients/search', () => {
  it('should return 401 when not authed (B3)', async () => {
    mockAuthState = { authed: false } as any
    const req = new Request('http://localhost/api/admin/clients/search?q=test@example.com')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(401)
  })

  it('should return empty when q empty and no dates', async () => {
    const req = new Request('http://localhost/api/admin/clients/search')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    const json = await res.json() as any
    expect(json.results).toEqual([])
    expect(json.clients).toEqual([])
  })

  it('should use case-insensitive LIKE for email/name filters', async () => {
    let capturedQuery = ''
    let capturedBinds: any[] = []
    mockDb.prepare.mockImplementation((query: string) => {
      capturedQuery = query
      return {
        bind: (...args: any[]) => {
          capturedBinds = args
          return {
            all: vi.fn().mockResolvedValue({ results: [{ contact_id: 'c1', first_name: 'John', last_name: 'Doe', email: 'john@example.com' }] }),
          }
        },
      } as any
    })

    // Second prepare for folders/meetings
    let callCount = 0
    mockDb.prepare.mockImplementation((query: string) => {
      callCount++
      if (callCount === 1) {
        capturedQuery = query
        return {
          bind: (...args: any[]) => {
            capturedBinds = args
            return {
              all: vi.fn().mockResolvedValue({ results: [{ contact_id: 'c1', first_name: 'John', email: 'john@example.com' }] }),
            }
          },
        } as any
      }
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/search?q=JOHN@EXAMPLE.COM')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(200)
    // should lower case the like term
    expect(capturedBinds[0]).toBe('%john@example.com%')
    expect(capturedQuery.toLowerCase()).toContain('like')
  })

  it('should return required fields grouped', async () => {
    const contact = { contact_id: 'c1', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', phone: '123', drive_folder_url: 'https://drive/folders/abc123', drive_folder_id: 'abc123', drive_is_manual: 1 }
    let call = 0
    mockDb.prepare.mockImplementation((q: string) => {
      call++
      if (call === 1) {
        return {
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [contact] }),
        } as any
      }
      if (q.includes('client_drive_folders')) {
        return {
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({ results: [{ contact_id: 'c1', year: 2026, folder_url: 'https://drive/folders/year', folder_id: 'year-id', parent_folder_id: 'parent', parent_folder_url: 'p', is_manual: 0 }] }),
        } as any
      }
      if (q.includes('bookings')) {
        return {
          bind: vi.fn().mockReturnThis(),
          all: vi.fn().mockResolvedValue({
            results: [{ contact_id: 'c1', booking_id: 'b1', calendar_event_id: 'ev1', meet_link: 'https://meet', purpose: 'Tax', slot_start: new Date().toISOString(), slot_end: new Date().toISOString(), time_zone: 'America/New_York', status: 'confirmed', cancel_token: 'tok' }],
          }),
        } as any
      }
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/search?q=jane@example.com')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    const json = await res.json() as any
    expect(json.clients).toHaveLength(1)
    expect(json.clients[0].contact_id).toBe('c1')
    expect(json.clients[0].year_folders).toHaveLength(1)
    expect(json.clients[0].meetings).toHaveLength(1)
    expect(json.results[0].booking_id).toBe('b1')
  })

  it('should filter by time range when start_date/end_date provided', async () => {
    let capturedQuery = ''
    let capturedBinds: any[] = []
    let call = 0
    mockDb.prepare.mockImplementation((q: string) => {
      call++
      if (call === 1 && q.includes('contacts')) {
        capturedQuery = q
        return {
          bind: (...args: any[]) => {
            capturedBinds = args
            return { all: vi.fn().mockResolvedValue({ results: [] }) }
          },
        } as any
      }
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [] }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/search?start_date=2026-01-01&end_date=2026-12-31')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.clients).toEqual([])
  })

  it('should return all when date filter but no q — no 400 on past meetings', async () => {
    let call = 0
    mockDb.prepare.mockImplementation((q: string) => {
      call++
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({
          results: call === 1 ? [{ contact_id: 'c1', first_name: 'A', email: 'a@b.com' }] : [],
        }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/search?start_date=2024-01-01')
    const res = await onRequestGet({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(200)
  })
})
