import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockAuthState = { authed: true, email: 'admin@test.com' } as any

vi.mock('../../../_lib/auth', async () => {
  const actual = (await vi.importActual('../../../_lib/auth')) as any
  return {
    ...actual,
    isAdminAuthenticated: vi.fn(() => mockAuthState),
  }
})

vi.mock('../../../_lib/email', async () => {
  const actual = (await vi.importActual('../../../_lib/email')) as any
  return {
    ...actual,
    sendAdminDriveEmail: vi.fn().mockResolvedValue({ success: true, id: 'email-id' }),
  }
})

const mockDb = {
  prepare: vi.fn(),
}

import { onRequestPost } from './send-email'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthState = { authed: true, email: 'admin@test.com' } as any
  import('../../../_lib/auth').then(mod => {
    const fn = (mod as any).isAdminAuthenticated
    if (fn?.mockImplementation) fn.mockImplementation(() => mockAuthState)
  })
})

describe('POST /api/admin/clients/send-email', () => {
  it('should return 401 when not authed', async () => {
    mockAuthState = { authed: false } as any
    const req = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'c1' }),
    })
    const res = await onRequestPost({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(401)
  })

  it('should return 404 when contact not found', async () => {
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      all: vi.fn().mockResolvedValue({ results: [] }),
    } as any)

    const req = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'nonexistent' }),
    })
    const res = await onRequestPost({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(404)
    const json = await res.json() as any
    expect(json.error).toBe('Contact not found')
  })

  it('should return 400 when booking_ids invalid for contact', async () => {
    let call = 0
    mockDb.prepare.mockImplementation(() => {
      call++
      if (call === 1) {
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ id: 'c1', email: 'client@example.com', first_name: 'John', drive_folder_url: 'https://drive/folders/abc' }),
        } as any
      }
      // all meetings
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [{ id: 'b1', slot_start: new Date(Date.now() + 86400000).toISOString() }] }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'c1', booking_ids: ['b2'] }),
    })
    const res = await onRequestPost({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(400)
    const json = await res.json() as any
    expect(json.error).toContain('booking_ids')
    expect(json.invalid).toContain('b2')
  })

  it('should send future only meetings when no booking_ids filter', async () => {
    let call = 0
    const future = new Date(Date.now() + 86400000).toISOString()
    mockDb.prepare.mockImplementation((q: string) => {
      call++
      if (q.includes('contacts')) {
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ id: 'c1', email: 'client@example.com', first_name: 'Jane', drive_folder_url: null }),
        } as any
      }
      if (q.includes('client_drive_folders')) {
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ folder_url: 'https://drive/folders/fallback' }),
        } as any
      }
      // bookings query
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [{ id: 'b1', slot_start: future, slot_end: future, time_zone: 'America/New_York', purpose: 'Meeting', meet_link: 'https://meet', cancel_token: 'tok' }] }),
      } as any
    })

    const { sendAdminDriveEmail } = await import('../../../_lib/email')
    const req = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'c1' }),
    })
    const res = await onRequestPost({ request: req, env: { DB: mockDb } as any } as any)
    expect(res.status).toBe(200)
    const json = await res.json() as any
    expect(json.success).toBe(true)
    expect(json.meetingsCount).toBe(1)
    expect(sendAdminDriveEmail).toHaveBeenCalledTimes(1)
  })

  it('should return full contract with driveLink fallback sentinel handled (M1)', async () => {
    let call = 0
    const future = new Date(Date.now() + 86400000).toISOString()
    mockDb.prepare.mockImplementation((q: string) => {
      call++
      if (q.includes('contacts')) {
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue({ id: 'c1', email: 'client@example.com', first_name: 'Jane', drive_folder_url: null }),
        } as any
      }
      if (q.includes('client_drive_folders')) {
        return {
          bind: vi.fn().mockReturnThis(),
          first: vi.fn().mockResolvedValue(null),
        } as any
      }
      return {
        bind: vi.fn().mockReturnThis(),
        all: vi.fn().mockResolvedValue({ results: [{ id: 'b1', slot_start: future, slot_end: future, time_zone: 'America/New_York', purpose: 'Meeting', meet_link: 'https://meet', cancel_token: 'tok' }] }),
      } as any
    })

    const req = new Request('http://localhost/api/admin/clients/send-email', {
      method: 'POST',
      body: JSON.stringify({ contact_id: 'c1' }),
    })
    const res = await onRequestPost({ request: req, env: { DB: mockDb } as any } as any)
    const json = await res.json() as any
    // M1: driveLink should be null, not sentinel string used as href
    expect(json.success).toBe(true)
    expect(json.sentTo).toBe('client@example.com')
    expect(json.driveLink).toBeNull()
    // Verify buildAdminDriveEmail does not render sentinel as href
    const { buildAdminDriveEmail } = await import('../../../_lib/email')
    const html = buildAdminDriveEmail({ firstName: 'Jane', driveLink: json.driveLink, meetings: [] })
    expect(html).not.toContain('href="No folder')
    expect(html).toContain('No folder found yet')
  })
})
