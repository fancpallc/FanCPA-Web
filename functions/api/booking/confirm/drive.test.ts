import { describe, it, expect, vi, beforeEach } from 'vitest'

const { mockEnsure, mockCreateEvent, mockSendEmail, mockGetDiag } = vi.hoisted(() => ({
  mockEnsure: vi.fn() as any,
  mockCreateEvent: vi.fn() as any,
  mockSendEmail: vi.fn() as any,
  mockGetDiag: vi.fn(() => ({ diag: 'ok' } as any)) as any,
}))

vi.mock('../../../_lib/google-drive', () => ({
  ensureClientDriveFolder: mockEnsure,
  extractFolderId: (url: string) => /\/folders\/([A-Za-z0-9-_]+)/.exec(url)?.[1] || null,
}))
vi.mock('../../../_lib/google-calendar', async () => {
  const actual: any = await vi.importActual('../../../_lib/google-calendar')
  return {
    ...actual,
    createBookingEvent: mockCreateEvent,
    getDiagInfo: mockGetDiag,
    TIMEZONE: 'America/New_York',
  }
})
vi.mock('../../../_lib/email', () => ({
  sendConfirmationEmail: mockSendEmail,
}))

import { onRequestGet } from './[token]'

function makeDb(pending: any, opts?: { onInsertBookings?: any; onUpsertDrive?: any; onDeletePending?: any }) {
  const calls: any[] = []
  return {
    _calls: calls,
    prepare: (sql: string) => ({
      bind: (...args: any[]) => ({
        first: async () => {
          calls.push({ sql, args, op: 'first' })
          if (sql.includes('FROM pending_bookings WHERE confirm_token')) return pending
          if (sql.includes('FROM contacts WHERE email')) return null
          if (sql.includes('FROM contacts WHERE id')) return { drive_folder_id: null, drive_is_manual: 0 }
          return null
        },
        run: async () => {
          calls.push({ sql, args, op: 'run' })
          if (sql.includes('INSERT INTO bookings')) {
            opts?.onInsertBookings?.(sql, args)
          }
          if (sql.includes('INTO client_drive_folders')) {
            opts?.onUpsertDrive?.(sql, args)
          }
          if (sql.includes('DELETE FROM pending_bookings')) {
            opts?.onDeletePending?.(sql, args)
          }
          return { success: true }
        },
        all: async () => ({ results: [] }),
      }),
    }),
  } as any
}

const basePending = {
  email: 'client@example.com',
  first_name: 'Test',
  last_name: 'Client',
  phone: '123',
  slot_start: new Date(Date.now() + 86400000).toISOString(),
  slot_end: new Date(Date.now() + 86400000 + 1800000).toISOString(),
  slot_date: new Date(Date.now() + 86400000).toISOString().split('T')[0],
  time_zone: 'America/New_York',
  purpose: 'Intro',
  contact_id: null,
  status: 'pending',
  expires_at: new Date(Date.now() + 86400000).toISOString(),
}

describe('confirm/[token] Drive non-blocking (HIGH regression)', () => {
  beforeEach(() => {
    vi.resetAllMocks()
    mockCreateEvent.mockResolvedValue({
      calendarEventId: 'evt-123',
      meetLink: 'https://meet.google.com/abc-defg-hij',
      source: 'live',
      error: undefined,
    })
    mockSendEmail.mockResolvedValue({ success: true, source: 'live' })
    mockGetDiag.mockReturnValue({ bookingCalendar: true, gcalKey: true } as any)
  })

  it('creates drive entry and passes link to email and booking in local (stub persists for exercisability)', async () => {
    const mockDrive = {
      yearFolderId: 'y-id',
      yearFolderUrl: 'https://drive.google.com/drive/folders/y-id',
      emailFolderId: 'e-id',
      emailFolderUrl: 'https://drive.google.com/drive/folders/e-id',
      source: 'live',
    }
    mockEnsure.mockResolvedValue(mockDrive)

    let bookingDriveUrl: string | null = 'not-set'
    const db = makeDb(basePending, {
      onInsertBookings: (_sql: string, args: any[]) => {
        // args: bookingId, contactId, calendarEventId, purpose, cancelToken, slot_start, slot_end, meetLink, tz, driveLink
        bookingDriveUrl = args[10]
      },
    })

    const env = {
      DB: db,
      ENVIRONMENT: 'local',
      SITE_URL: 'https://example.com',
    } as any
    const request = new Request('https://example.com/api/booking/confirm/tok-123')
    const res = await onRequestGet({ params: { token: 'tok-123' }, env, request } as any)

    expect(res.status).toBe(200)
    expect(mockEnsure).toHaveBeenCalled()
    // In local, drive link should be persisted and passed to booking
    expect(bookingDriveUrl).toBe(mockDrive.yearFolderUrl)
    expect(mockSendEmail).toHaveBeenCalled()
    const emailArg = mockSendEmail.mock.calls[0][0]
    expect(emailArg.driveFolderUrl).toBe(mockDrive.yearFolderUrl)
  })

  it('is non-blocking when drive throws error in production — booking still succeeds without drive link', async () => {
    mockEnsure.mockRejectedValue(new Error('Drive outage'))

    let bookingDriveUrl: string | null = 'not-set'
    let pendingDeleted = false
    const db = makeDb(basePending, {
      onInsertBookings: (_sql: string, args: any[]) => {
        bookingDriveUrl = args[10]
      },
      onDeletePending: () => {
        pendingDeleted = true
      },
    })

    const env = {
      DB: db,
      ENVIRONMENT: 'production',
      BOOKING_CALENDAR_ID: 'cal-id',
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'csec',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'rtok',
      SITE_URL: 'https://example.com',
      RESEND_API_KEY: 'key',
    } as any
    const request = new Request('https://example.com/api/booking/confirm/tok-123')
    const res = await onRequestGet({ params: { token: 'tok-123' }, env, request } as any)

    // Must NOT be 502 — booking must succeed even if Drive fails (plan §5, PR-3)
    expect(res.status).toBe(200)
    expect(pendingDeleted).toBe(true)
    // Booking must have null drive link, not fake-
    expect(bookingDriveUrl).toBeNull()
    // Email must be sent without drive link
    expect(mockSendEmail).toHaveBeenCalled()
    const emailArg = mockSendEmail.mock.calls[0][0]
    expect(emailArg.driveFolderUrl).toBeUndefined()
  })

  it('refuses to persist fake link in live env (C1) but still succeeds', async () => {
    const fakeDrive = {
      yearFolderId: 'fake-client-example-com-2026',
      yearFolderUrl: 'https://drive.google.com/drive/folders/fake-client-example-com-2026',
      emailFolderId: 'fake-client-example-com',
      emailFolderUrl: 'https://drive.google.com/drive/folders/fake-client-example-com',
      source: 'stub',
      error: 'OAuth token exchange failed',
    }
    mockEnsure.mockResolvedValue(fakeDrive as any)

    let driveUpserted = false
    let bookingDriveUrl: string | null = 'not-set'
    const db = makeDb(basePending, {
      onUpsertDrive: () => {
        driveUpserted = true
      },
      onInsertBookings: (_sql: string, args: any[]) => {
        bookingDriveUrl = args[10]
      },
    })

    const env = {
      DB: db,
      ENVIRONMENT: 'production',
      BOOKING_CALENDAR_ID: 'cal-id',
      GOOGLE_OAUTH_CLIENT_ID: 'cid',
      GOOGLE_OAUTH_CLIENT_SECRET: 'csec',
      GOOGLE_OAUTH_REFRESH_TOKEN: 'rtok',
      SITE_URL: 'https://example.com',
      RESEND_API_KEY: 'key',
    } as any
    const request = new Request('https://example.com/api/booking/confirm/tok-123')
    const res = await onRequestGet({ params: { token: 'tok-123' }, env, request } as any)

    expect(res.status).toBe(200)
    // Must NOT persist fake- ids in live env (C1)
    expect(driveUpserted).toBe(false)
    expect(bookingDriveUrl).toBeNull()
  })

  it('in local env persists fake for exercisability (matches manual.ts gating)', async () => {
    const fakeDrive = {
      yearFolderId: 'fake-client-example-com-2026',
      yearFolderUrl: 'https://drive.google.com/drive/folders/fake-client-example-com-2026',
      emailFolderId: 'fake-client-example-com',
      emailFolderUrl: 'https://drive.google.com/drive/folders/fake-client-example-com',
      source: 'stub',
    }
    mockEnsure.mockResolvedValue(fakeDrive as any)

    let driveUpserted = false
    const db = makeDb(basePending, {
      onUpsertDrive: () => {
        driveUpserted = true
      },
    })

    const env = {
      DB: db,
      ENVIRONMENT: 'local',
      SITE_URL: 'https://example.com',
    } as any
    const request = new Request('https://example.com/api/booking/confirm/tok-123')
    const res = await onRequestGet({ params: { token: 'tok-123' }, env, request } as any)

    expect(res.status).toBe(200)
    // In local, fake SHOULD be persisted so portal flow is exercisable
    expect(driveUpserted).toBe(true)
  })
})
