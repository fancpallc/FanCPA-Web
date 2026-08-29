import { describe, it, expect, vi, beforeEach } from 'vitest'

let mockAuthState = { authed: true, email: 'admin@test.com', bypass: true } as any
vi.mock('../../../_lib/auth', async () => {
  const actual = (await vi.importActual('../../../_lib/auth')) as any
  return {
    ...actual,
    isAdminAuthenticated: vi.fn(() => mockAuthState),
  }
})

const mockDb = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn(),
  }),
}

vi.mock('../../../_lib/google-calendar', () => ({
  deleteBookingEvent: vi.fn().mockResolvedValue(true),
}))

vi.mock('../../../_lib/env', async () => {
  const actual = (await vi.importActual('../../../_lib/env')) as any
  return {
    ...actual,
    getBookingCalendarId: vi.fn().mockReturnValue('booking-cal-id'),
    getPersonalCalendarId: vi.fn().mockReturnValue('personal-cal-id'),
  }
})

vi.mock('../../../_lib/email', async () => {
  const actual = (await vi.importActual('../../../_lib/email')) as any
  return {
    ...actual,
    sendBookingCancelledEmail: vi.fn().mockResolvedValue({ success: true, source: 'stub' }),
  }
})

import { onRequestDelete } from './[id]'

beforeEach(() => {
  vi.clearAllMocks()
  mockAuthState = { authed: true, email: 'admin@test.com', bypass: true } as any
  mockDb.prepare.mockReturnValue({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn().mockResolvedValue(null),
    run: vi.fn().mockResolvedValue({}),
  } as any)
})

describe('DELETE /api/admin/bookings/:id', () => {
  it('should return 401 when admin auth fails (B3)', async () => {
    mockAuthState = { authed: false, error: 'Unauthorized' } as any

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const response = await onRequestDelete({ request, env: { DB: mockDb } as any, params: { id: '123' } } as any)

    expect(response.status).toBe(401)
    const body = await response.json() as any
    expect(body.error).toBe('Unauthorized')
  })

  it('should return 404 if booking not found', async () => {
    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue(null),
      run: vi.fn(),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123')
    const response = await onRequestDelete({ request, env: { DB: mockDb } as any, params: { id: '123' } } as any)

    expect(response.status).toBe(404)
  })

  it('should delete without calling calendar if cancelMeeting=false', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'cal-id',
        contact_id: 'c1',
        contact_email: 'x@y.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=false')
    const env = { DB: mockDb }
    await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(deleteBookingEvent).not.toHaveBeenCalled()
  })

  it('should call calendar delete if cancelMeeting=true', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'cal-id',
        contact_id: 'c1',
        contact_email: 'x@y.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb }
    await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(deleteBookingEvent).toHaveBeenCalledTimes(2)
    expect(deleteBookingEvent).toHaveBeenCalledWith(env, 'cal-id', 'booking-cal-id')
    expect(deleteBookingEvent).toHaveBeenCalledWith(env, 'cal-id', 'personal-cal-id')
  })

  it('should return 502 when calendar delete fails and credentials exist', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    vi.mocked(deleteBookingEvent).mockResolvedValueOnce(false).mockResolvedValueOnce(false)

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'real-event-id',
        contact_id: 'c1',
        contact_email: 'x@y.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb, GCAL_SERVICE_ACCOUNT_KEY: '{"client_email":"a@b.com"}' } as any
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(response.status).toBe(502)
    const body = await response.json() as any
    expect(body.error).toContain('Calendar event deletion failed')
  })

  it('should skip calendar delete for stub event ids and still delete DB', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'stub-event-abc',
        contact_id: 'c1',
        contact_email: 'x@y.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb } as any
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(deleteBookingEvent).not.toHaveBeenCalled()
    expect(response.status).toBe(200)
  })

  it('should return success with warning when no credentials and calendar delete fails', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    vi.mocked(deleteBookingEvent).mockResolvedValue(false)

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'real-event-id',
        contact_id: 'c1',
        contact_email: 'x@y.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb } as any // no creds
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(response.status).toBe(200)
  })

  it('should return 502 on partial calendar delete failure (1 of 2) and preserve DB row', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    // First succeeds, second fails
    vi.mocked(deleteBookingEvent).mockResolvedValueOnce(true).mockResolvedValueOnce(false)

    const runMock = vi.fn().mockResolvedValue({})
    const firstMock = vi.fn().mockResolvedValue({
      id: '123',
      calendar_event_id: 'real-event-id-2cal',
      contact_id: 'c1',
      contact_email: 'x@y.com',
      slot_start: new Date().toISOString(),
    })

    mockDb.prepare.mockImplementation(() => ({
      bind: vi.fn().mockReturnThis(),
      first: firstMock,
      run: runMock,
    }) as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb, GCAL_SERVICE_ACCOUNT_KEY: '{"client_email":"a@b.com"}' } as any
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(response.status).toBe(502)
    const body = await response.json() as any
    expect(body.error).toContain('partially failed')
    expect(body.calendarDeleteAttempted).toBe(2)
    expect(body.calendarDeleteSucceeded).toBe(1)
    // DB DELETE should NOT have been called — row preserved for retry
    expect(runMock).not.toHaveBeenCalled()
  })

  it('should report notified=false when contact_email is null (nothing to send)', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    vi.mocked(deleteBookingEvent).mockResolvedValue(true)

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'cal-id',
        contact_id: 'c1',
        contact_email: null,
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    // notifyClient=true but no email → notified should be false, not true (intent vs outcome)
    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true&notifyClient=true')
    const env = { DB: mockDb } as any
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.notified).toBe(false)
    expect(body.notifyAttempted).toBe(true)
    expect(body.notifyError).toBeDefined()
  })

  it('should report notified=false when email send fails', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    const { sendBookingCancelledEmail } = await import('../../../_lib/email')
    vi.mocked(deleteBookingEvent).mockResolvedValue(true)
    vi.mocked(sendBookingCancelledEmail).mockResolvedValueOnce({ success: false, error: 'Resend down' } as any)

    mockDb.prepare.mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn().mockResolvedValue({
        id: '123',
        calendar_event_id: 'cal-id',
        contact_id: 'c1',
        contact_email: 'client@example.com',
        slot_start: new Date().toISOString(),
      }),
      run: vi.fn().mockResolvedValue({}),
    } as any)

    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true&notifyClient=true')
    const env = { DB: mockDb } as any
    const response = await onRequestDelete({ request, env, params: { id: '123' } } as any)

    expect(response.status).toBe(200)
    const body = await response.json() as any
    expect(body.notified).toBe(false)
    expect(body.notifyError).toContain('Resend down')
  })
})
