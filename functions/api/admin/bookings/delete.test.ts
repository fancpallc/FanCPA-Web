import { describe, it, expect, vi } from 'vitest'
import { onRequestDelete } from './[id]'

// Mocking dependencies
const mockDb = {
  prepare: vi.fn().mockReturnValue({
    bind: vi.fn().mockReturnThis(),
    first: vi.fn(),
    run: vi.fn(),
  }),
}

vi.mock('../../../_lib/google-calendar', () => ({
  deleteBookingEvent: vi.fn(),
}))

vi.mock('../../../_lib/env', () => ({
  getBookingCalendarId: vi.fn().mockReturnValue('booking-cal-id'),
  getPersonalCalendarId: vi.fn().mockReturnValue('personal-cal-id'),
}))

describe('DELETE /api/admin/bookings/:id', () => {
  it('should return 404 if booking not found', async () => {
    mockDb.prepare('').first.mockResolvedValue(null)
    
    const request = new Request('http://localhost/api/admin/bookings/123')
    const response = await onRequestDelete({ request, env: { DB: mockDb }, params: { id: '123' } })
    
    expect(response.status).toBe(404)
  })

  it('should delete without calling calendar if cancelMeeting=false', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    
    mockDb.prepare('').first.mockResolvedValue({ id: '123', calendar_event_id: 'cal-id' })
    mockDb.prepare('').run.mockResolvedValue({})
    
    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=false')
    const env = { DB: mockDb }
    await onRequestDelete({ request, env, params: { id: '123' } })
    
    expect(deleteBookingEvent).not.toHaveBeenCalled()
  })

  it('should call calendar delete if cancelMeeting=true', async () => {
    const { deleteBookingEvent } = await import('../../../_lib/google-calendar')
    
    mockDb.prepare('').first.mockResolvedValue({ id: '123', calendar_event_id: 'cal-id' })
    mockDb.prepare('').run.mockResolvedValue({})
    
    const request = new Request('http://localhost/api/admin/bookings/123?cancelMeeting=true')
    const env = { DB: mockDb }
    await onRequestDelete({ request, env, params: { id: '123' } })
    
    expect(deleteBookingEvent).toHaveBeenCalledTimes(2)
    expect(deleteBookingEvent).toHaveBeenCalledWith(env, 'cal-id', 'booking-cal-id')
    expect(deleteBookingEvent).toHaveBeenCalledWith(env, 'cal-id', 'personal-cal-id')
  })
})

