import { expect, test, vi, describe, beforeEach } from 'vitest'
import { onRequestGet } from './[token]'

// Mock dependencies
vi.mock('../../../_lib/google-drive', () => ({
  ensureClientDriveFolder: vi.fn(),
}))
vi.mock('../../../_lib/google-calendar', () => ({
  createBookingEvent: vi.fn(),
  getDiagInfo: vi.fn(),
  TIMEZONE: 'UTC'
}))
vi.mock('../../../_lib/email', () => ({
  sendConfirmationEmail: vi.fn(),
}))

import { ensureClientDriveFolder } from '../../../_lib/google-drive'
import { createBookingEvent } from '../../../_lib/google-calendar'
import { sendConfirmationEmail } from '../../../_lib/email'

describe('booking confirm - drive integration', () => {
  const mockDb = {
    prepare: vi.fn().mockReturnValue({
      bind: vi.fn().mockReturnThis(),
      first: vi.fn(),
      run: vi.fn().mockResolvedValue({}),
    }),
  }

  const mockEnv = {
    DB: mockDb,
    ENVIRONMENT: 'test',
    STUB: 'false' // Ensure not treated as stub for live code paths
  }

  beforeEach(() => {
    vi.clearAllMocks()
    // Use a future date for slot_start so it is never in the past
    const futureDate = new Date(Date.now() + 86400000).toISOString()
    mockDb.prepare().first.mockResolvedValue({
      confirm_token: 'valid-token',
      email: 'test@example.com',
      slot_start: futureDate,
      slot_end: new Date(Date.now() + 90000000).toISOString(),
      expires_at: new Date(Date.now() + 3600000).toISOString(),
      status: 'pending',
      first_name: 'Test',
      last_name: 'User'
    })
    
    ;(createBookingEvent as any).mockResolvedValue({
      calendarEventId: 'evt-123',
      meetLink: 'https://meet.google.com/abc',
      source: 'live' // Make it live so it doesn't short-circuit
    })
  })

  test('creates drive entry and includes link in email', async () => {
    const mockDrive = {
      yearFolderId: 'y-id',
      yearFolderUrl: 'https://drive.com/year',
      emailFolderId: 'e-id',
      emailFolderUrl: 'https://drive.com/email'
    }
    ;(ensureClientDriveFolder as any).mockResolvedValue(mockDrive)
    ;(sendConfirmationEmail as any).mockResolvedValue({ success: true })

    const context = {
      params: { token: 'valid-token' },
      env: mockEnv,
      request: new Request('http://localhost')
    } as any

    await onRequestGet(context)

    expect(ensureClientDriveFolder).toHaveBeenCalled()
    expect(sendConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
      driveFolderUrl: 'https://drive.com/year'
    }))
  })

  test('is non-blocking when drive throws error', async () => {
    ;(ensureClientDriveFolder as any).mockRejectedValue(new Error('Drive failed'))
    ;(sendConfirmationEmail as any).mockResolvedValue({ success: true })

    const context = {
      params: { token: 'valid-token' },
      env: mockEnv,
      request: new Request('http://localhost')
    } as any

    const response = await onRequestGet(context)
    
    // Should still proceed and return 200
    expect(response.status).toBe(200)
    // Email should be called without drive link
    expect(sendConfirmationEmail).toHaveBeenCalledWith(expect.objectContaining({
      driveFolderUrl: undefined
    }))
  })
})

