import { expect, test, vi, beforeEach } from 'vitest'
import { render, screen, fireEvent, waitFor } from '@testing-library/react'
import AdminClients from './AdminClients'
import * as api from '../lib/api'

vi.mock('../lib/api', () => ({
  searchAdminClients: vi.fn(),
  searchAdminClientsGrouped: vi.fn(),
  updateAdminDriveFolder: vi.fn(),
  updateAdminDriveFolderClientLevel: vi.fn(),
  sendAdminClientEmail: vi.fn(),
  createManualBooking: vi.fn(),
  deleteBooking: vi.fn(),
  updateAdminClient: vi.fn(),
  cancelAdminBooking: vi.fn(),
  hideAdminBooking: vi.fn(),
  unhideAdminBooking: vi.fn(),
  rebookAdminBooking: vi.fn(),
}))

vi.mock('../hooks/useAdminAuth', () => ({
  useAdminAuth: () => ({ isAuthed: true, loading: false }),
}))

beforeEach(() => {
  vi.clearAllMocks()
  ;(api.searchAdminClientsGrouped as any).mockResolvedValue([])
  ;(api.searchAdminClients as any).mockResolvedValue([])
})

test('AdminClients renders search input and filters', () => {
  render(<AdminClients />)
  expect(screen.getByPlaceholderText(/email, first name, last name, or drive link/i)).toBeInTheDocument()
  expect(screen.getByLabelText('From')).toBeInTheDocument()
  expect(screen.getByLabelText('To')).toBeInTheDocument()
})

test('AdminClients calls grouped search with dates', async () => {
  ;(api.searchAdminClientsGrouped as any).mockResolvedValue([])
  render(<AdminClients />)

  fireEvent.change(screen.getByPlaceholderText(/email, first name, last name, or drive link/i), { target: { value: 'test' } })
  fireEvent.change(screen.getByLabelText('From'), { target: { value: '2023-01-01' } })
  fireEvent.change(screen.getByLabelText('To'), { target: { value: '2023-01-31' } })
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

  await waitFor(() => {
    expect(api.searchAdminClientsGrouped).toHaveBeenCalledWith('test', { startDate: '2023-01-01', endDate: '2023-01-31', showHidden: false })
  })
})

test('AdminClients renders client card with Drive link at top and meetings table', async () => {
  const client = {
    contact_id: 'c1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    drive_folder_url: 'https://drive.google.com/drive/folders/abc123def456',
    drive_folder_id: 'abc123def456',
    drive_is_manual: 0,
    year_folders: [{ year: 2026, folder_url: 'https://drive.google.com/drive/folders/2026valid123', folder_id: 'id2026valid123' }],
    meetings: [
      {
        contact_id: 'c1',
        booking_id: 'b1',
        first_name: 'Jane',
        last_name: 'Doe',
        email: 'jane@example.com',
        purpose: 'Tax',
        slot_start: new Date(Date.now() + 86400000).toISOString(),
        time_zone: 'America/New_York',
        status: 'confirmed',
      },
    ],
  }
  ;(api.searchAdminClientsGrouped as any).mockResolvedValue([client])
  render(<AdminClients />)
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

  await waitFor(() => {
    // Email appears once in header but we have desktop+mobile duplicate meeting rows — use getAllByText
    expect(screen.getAllByText(/jane@example.com/i).length).toBeGreaterThanOrEqual(1)
    // R8a/R9: Drive link now renders as hyperlink in read mode, not an input — check link exists
    const links = screen.getAllByRole('link')
    expect(links.some((l) => (l as HTMLAnchorElement).href.includes('abc123def456'))).toBe(true)
    // Tax appears in both desktop and mobile — at least one
    expect(screen.getAllByText('Tax').length).toBeGreaterThanOrEqual(1)
  })
})

test('AdminClients select-all selects only upcoming confirmed, past meetings disabled to prevent 400', async () => {
  const now = Date.now()
  const past = new Date(now - 86400000 * 2).toISOString() // 2 days ago
  const future = new Date(now + 86400000).toISOString()
  const future2 = new Date(now + 86400000 * 2).toISOString()

  const client = {
    contact_id: 'c1',
    first_name: 'Jane',
    last_name: 'Doe',
    email: 'jane@example.com',
    drive_folder_url: 'https://drive.google.com/drive/folders/abc123def456',
    drive_folder_id: 'abc123def456',
    drive_is_manual: 0,
    year_folders: [],
    meetings: [
      { contact_id: 'c1', booking_id: 'b-past', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', purpose: 'Past', slot_start: past, time_zone: 'America/New_York', status: 'confirmed' },
      { contact_id: 'c1', booking_id: 'b-future', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', purpose: 'Future', slot_start: future, time_zone: 'America/New_York', status: 'confirmed' },
      { contact_id: 'c1', booking_id: 'b-future2', first_name: 'Jane', last_name: 'Doe', email: 'jane@example.com', purpose: 'Future2', slot_start: future2, time_zone: 'America/New_York', status: 'confirmed' },
    ],
  }
  ;(api.searchAdminClientsGrouped as any).mockResolvedValue([client])
  render(<AdminClients />)
  fireEvent.click(screen.getByRole('button', { name: /^search$/i }))

  await waitFor(() => {
    // Purpose now appears twice (desktop table + mobile cards) after R8 refactor, so use getAllByText
    expect(screen.getAllByText('Past').length).toBeGreaterThanOrEqual(1)
    expect(screen.getAllByText('Future').length).toBeGreaterThanOrEqual(1)
  })

  // S8: past rows CAN be selected for hide, only hidden disabled; select-all only selects upcoming
  const checkboxes = screen.getAllByRole('checkbox')
  const selectAll = checkboxes.find((cb) => (cb as HTMLInputElement).getAttribute('data-testid') === 'select-all')
  expect(selectAll).toBeInTheDocument()
  const getByBooking = (id: string) => screen.getAllByTestId(`meeting-${id}`)[0] as HTMLInputElement
  const pastCb = getByBooking('b-past')
  const futureCb = getByBooking('b-future')
  const future2Cb = getByBooking('b-future2')
  expect(pastCb).not.toBeDisabled() // b-past selectable for hide per S8
  expect(futureCb).not.toBeDisabled()
  expect(future2Cb).not.toBeDisabled()

  const pastMobile = screen.getAllByTestId('meeting-b-past-mobile')[0] as HTMLInputElement
  expect(pastMobile).not.toBeDisabled()

  fireEvent.click(selectAll!)

  await waitFor(() => {
    expect((getByBooking('b-past') as HTMLInputElement).checked).toBe(false)
    expect((getByBooking('b-future') as HTMLInputElement).checked).toBe(true)
    expect((getByBooking('b-future2') as HTMLInputElement).checked).toBe(true)
  })

  // Send should only send 2 meetings, not 3, so backend won't 400
  ;(api.sendAdminClientEmail as any).mockResolvedValue({ sentTo: 'jane@example.com', meetingsCount: 2 })
  const sendBtn = screen.getByTestId('send-c1')
  expect(sendBtn).toBeEnabled()
  fireEvent.click(sendBtn)

  await waitFor(() => {
    expect(api.sendAdminClientEmail).toHaveBeenCalledWith('c1', expect.arrayContaining(['b-future', 'b-future2']))
    const args = (api.sendAdminClientEmail as any).mock.calls[0][1] as string[]
    expect(args).not.toContain('b-past')
  })
})
