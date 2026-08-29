import { debug } from './debug'
export interface HealthResponse {
  status: 'ok' | 'error' | 'degraded'
  db: 'ok' | 'error'
  r2: 'ok' | 'error'
  timestamp: string
  env: string
  checks?: {
    d1Ms: number
    r2Ms: number
  }
  dbError?: string
  r2Error?: string
  sampleImageUrl?: string
}

export interface Page {
  id: string
  slug: string
  title: string
  meta_description?: string | null
  /** Wordmark in the header and the footer brand. */
  site_name?: string | null
  /** The sentence under the footer brand. */
  footer_tagline?: string | null
  /** Optional icon/logo URL. */
  icon_url?: string | null
  booking_max_per_week?: number | null
  booking_min_notice_days?: number | null
  google_tag_manager_id?: string | null
  sort_order: number
  is_published: number
}

export interface SectionItem {
  id: string
  section_id: string
  title?: string | null
  body?: string | null
  image_url?: string | null
  icon?: string | null
  link_url?: string | null
  link_text?: string | null
  author?: string | null
  /** Testimonials only. NULL means "never set" and renders as 5. */
  rating?: number | null
  /** Owner-written description of image_url, for screen readers. */
  image_alt?: string | null
  sort_order: number
  is_visible: number
}

export interface Section {
  id: string
  page_id: string
  type: 'hero' | 'cards-grid' | 'testimonials' | 'text-block' | 'cta-banner' | 'image-gallery'
  heading?: string | null
  subheading?: string | null
  sort_order: number
  config: any
  is_visible: number
  items: SectionItem[]
}

export interface ContentResponse {
  page: Page
  sections: Section[]
}

export class ApiError extends Error {
  status: number
  body?: any
  constructor(message: string, status: number, body?: any) {
    super(message)
    this.name = 'ApiError'
    this.status = status
    this.body = body
  }
}

export interface FetchOptions {
  timeoutMs?: number
  signal?: AbortSignal
  cache?: RequestCache
}

export async function fetchJson(url: string, options: FetchOptions & { method?: string; body?: string } = {}) {
  const { timeoutMs = 8000, signal, method = 'GET', cache, body } = options as any
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  if (signal) {
    signal.addEventListener('abort', () => controller.abort(signal.reason))
  }
  try {
    if (true) debug(`!!! API_FETCH_START url=${url} method=${method} cache=${cache || 'default'} hasBody=${!!body} bodyLen=${body?.length || 0}`)
    const res = await fetch(url, { method, headers: { 'Content-Type': 'application/json' }, body, signal: controller.signal, cache: cache || 'no-store', credentials: 'same-origin' } as any)
    const json = await res.json().catch(() => null)
    if (!res.ok) {
      throw new ApiError(`Request failed with ${res.status}`, res.status, json)
    }
    if (!json) {
      throw new ApiError('Failed to parse response', res.status)
    }
    return { res, json }
  } catch (e: any) {
    if (e?.name === 'AbortError' || e?.message?.toLowerCase().includes('abort') || e?.message?.includes('timeout')) {
      throw new Error(`Request timeout/aborted after ${timeoutMs}ms: ${e.message}`)
    }
    if (e instanceof ApiError) throw e
    throw new Error(`Network error: ${e.message || String(e)}`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function fetchHealth(options: FetchOptions = {}): Promise<HealthResponse> {
  const { json } = await fetchJson('/api/health', options)
  return json as HealthResponse
}

export async function fetchContent(slug: string, options: FetchOptions = {}): Promise<ContentResponse> {
  const safeSlug = encodeURIComponent(slug)
  const { json } = await fetchJson(`/api/content/${safeSlug}`, options)
  return json as ContentResponse
}

export interface CalendarSlot {
  date: string // YYYY-MM-DD
  start: string // ISO
  end: string // ISO
  available: boolean
}

export interface SlotsResponse {
  slots: CalendarSlot[]
  weeks: number
  source: 'stub' | 'live' | string
  workingHours?: any
  calendars?: any
  error?: string
}

export async function fetchCalendarSlots(weeks: number = 2, options: FetchOptions = {}): Promise<CalendarSlot[]> {
  const bust = `_t=${Date.now()}`
  const sep = `?weeks=${weeks}`.includes('?') ? '&' : '?'
  const url = `/api/calendar/slots?weeks=${weeks}&${bust}`
  const { json } = await fetchJson(url, { ...options, cache: 'no-store' } as any)
  const data = json as SlotsResponse
  return data.slots as CalendarSlot[]
}

export async function fetchSlotsFull(weeks: number = 2, options: FetchOptions = {}): Promise<SlotsResponse> {
  const bust = `_t=${Date.now()}`
  const url = `/api/calendar/slots?weeks=${weeks}&${bust}`
  const { json } = await fetchJson(url, { ...options, cache: 'no-store' } as any)
  return json as SlotsResponse
}

export interface BookingPayload {
  firstName: string
  lastName: string
  email: string
  phone?: string
  purpose?: string
  slot: CalendarSlot | { date?: string; start: string; end: string }
  turnstileToken?: string
  confirmIntent?: boolean
  timeZone?: string
}

export interface BookingResponse {
  meetLink: string
  dateTime: string
  cancelUrl: string
  cancelToken?: string
  calendarEventId?: string
  source?: string
  warning?: string
  confirmIntent?: boolean
  duplicateWarning?: boolean
  gcalError?: string
  emailResult?: { success: boolean; source: string; error?: string; id?: string }
  diag?: { bookingCalendar: boolean; gcalKey: boolean; resendKey: boolean; env?: string }
  pending?: boolean
  confirmToken?: string
  confirmUrl?: string
  message?: string
  purpose?: string | null
  email?: string
  expiresAt?: string
}

export interface AdminAuthResponse {
  authed: boolean
  email?: string | null
  bypass?: boolean
  env?: string
  error?: string
  allowlistConfigured?: boolean
  diagnostics?: any
}

export interface AdminClientRow {
  contact_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  booking_id?: string
  meet_link?: string
  purpose?: string
  slot_start?: string
  slot_end?: string
  time_zone?: string
  status?: string
  cancel_token?: string
  year?: number
  year_folder_url?: string
  drive_folder_url?: string
  drive_folder_id?: string
}

export interface AdminClientCard {
  contact_id: string
  first_name: string
  last_name: string
  email: string
  phone?: string
  drive_folder_url?: string | null
  drive_folder_id?: string | null
  drive_is_manual?: number
  year_folders: { year: number; folder_url: string; folder_id?: string; parent_folder_id?: string; is_manual?: number }[]
  meetings: AdminClientRow[]
}

export async function fetchAdminAuth(options: FetchOptions = {}): Promise<AdminAuthResponse> {
  const { json } = await fetchJson('/api/admin/auth', { ...options, cache: 'no-store' } as any)
  return json as AdminAuthResponse
}

export interface SearchAdminClientsResult {
  results: AdminClientRow[] // legacy compat
  clients: AdminClientCard[]
}

export async function searchAdminClients(
  q: string,
  opts?: { startDate?: string; endDate?: string },
  options: FetchOptions = {}
): Promise<AdminClientRow[]> {
  const params = new URLSearchParams({ q })
  if (opts?.startDate) params.set('start_date', opts.startDate)
  if (opts?.endDate) params.set('end_date', opts.endDate)
  const { json } = await fetchJson(`/api/admin/clients/search?${params.toString()}`, { ...options })
  // Prefer grouped clients when present, but return legacy for old callers
  return (json as any).results as AdminClientRow[]
}

export async function searchAdminClientsGrouped(
  q: string,
  opts?: { startDate?: string; endDate?: string },
  options: FetchOptions = {}
): Promise<AdminClientCard[]> {
  const params = new URLSearchParams({ q })
  if (opts?.startDate) params.set('start_date', opts.startDate)
  if (opts?.endDate) params.set('end_date', opts.endDate)
  const { json } = await fetchJson(`/api/admin/clients/search?${params.toString()}`, { ...options })
  const data = json as any
  if (Array.isArray(data.clients) && data.clients.length > 0) return data.clients as AdminClientCard[]
  // Fallback: group legacy results client-side
  const results: AdminClientRow[] = data.results || []
  const map = new Map<string, AdminClientCard>()
  for (const r of results) {
    if (!map.has(r.contact_id)) {
      map.set(r.contact_id, {
        contact_id: r.contact_id,
        first_name: r.first_name,
        last_name: r.last_name,
        email: r.email,
        drive_folder_url: (r as any).drive_folder_url || r.year_folder_url || null,
        drive_folder_id: (r as any).drive_folder_id || null,
        drive_is_manual: 0,
        year_folders: [],
        meetings: [],
      })
    }
    if (r.booking_id) {
      map.get(r.contact_id)!.meetings.push(r)
    }
  }
  return Array.from(map.values())
}

export async function updateAdminDriveFolder(contact_id: string, yearOrUrl: string, folder_url?: string, options: FetchOptions = {}): Promise<void> {
  // L1 fix: remove brittle startsWith('http') overload — year is always 4 digits, URL never is.
  // - updateAdminDriveFolder(contact_id, year, url) → year-level
  // - updateAdminDriveFolder(contact_id, url) → client-level (deprecated, use updateAdminDriveFolderClientLevel)
  // Production uses updateAdminDriveFolderClientLevel; this remains only for legacy tests.
  if (folder_url) {
    await fetchJson('/api/admin/clients/drive-folder', {
      timeoutMs: (options as any).timeoutMs ?? 10000,
      ...(options as any),
      method: 'PATCH',
      body: JSON.stringify({ contact_id, year: yearOrUrl, folder_url }),
    })
  } else {
    await fetchJson('/api/admin/clients/drive-folder', {
      timeoutMs: (options as any).timeoutMs ?? 10000,
      ...(options as any),
      method: 'PATCH',
      body: JSON.stringify({ contact_id, folder_url: yearOrUrl }),
    })
  }
}

export async function updateAdminDriveFolderClientLevel(contact_id: string, folder_url: string, options: FetchOptions = {}): Promise<void> {
  await fetchJson('/api/admin/clients/drive-folder', {
    timeoutMs: (options as any).timeoutMs ?? 10000,
    ...(options as any),
    method: 'PATCH',
    body: JSON.stringify({ contact_id, folder_url }),
  })
}

export async function updateAdminClient(contact_id: string, fields: { first_name?: string; last_name?: string; phone?: string }, options: FetchOptions = {}): Promise<any> {
  const { json } = await fetchJson(`/api/admin/clients/${encodeURIComponent(contact_id)}`, {
    timeoutMs: (options as any).timeoutMs ?? 10000,
    ...(options as any),
    method: 'PATCH',
    body: JSON.stringify(fields),
  })
  return json
}

export interface SendAdminEmailResult {
  success: boolean
  sentTo: string
  meetingsCount: number
  driveLink: string
  emailResult?: any
}

export async function sendAdminClientEmail(contact_id: string, bookingIds?: string[], options: FetchOptions = {}): Promise<SendAdminEmailResult> {
  const { json } = await fetchJson('/api/admin/clients/send-email', {
    timeoutMs: (options as any).timeoutMs ?? 15000,
    ...(options as any),
    method: 'POST',
    body: JSON.stringify({ contact_id, ...(bookingIds && bookingIds.length ? { booking_ids: bookingIds } : {}) }),
  })
  return json as any
}

export async function createManualBooking(body: any, options: FetchOptions = {}): Promise<any> {
  const { json } = await fetchJson('/api/admin/bookings/manual', {
    timeoutMs: (options as any).timeoutMs ?? 20000,
    ...options,
    method: 'POST',
    body: JSON.stringify(body),
  })
  return json
}

export async function deleteBooking(
  bookingId: string,
  cancelMeeting: boolean,
  opts?: { notifyClient?: boolean } | boolean,
  options: FetchOptions = {}
): Promise<any> {
  // Back-compat: third arg can be notifyClient boolean or options object
  let notifyClient: boolean | undefined
  let fetchOpts: FetchOptions = options
  if (typeof opts === 'object' && opts !== null && !Array.isArray(opts) && ('notifyClient' in opts || Object.keys(opts).length === 0)) {
    // Actually this overload is ambiguous; handle as {notifyClient} when object has that key
    if ('notifyClient' in (opts as any)) {
      notifyClient = (opts as any).notifyClient
      fetchOpts = options
    } else {
      fetchOpts = opts as FetchOptions
    }
  } else if (typeof opts === 'boolean') {
    notifyClient = opts
  }
  let url = `/api/admin/bookings/${encodeURIComponent(bookingId)}?cancelMeeting=${cancelMeeting}`
  if (notifyClient !== undefined) url += `&notifyClient=${notifyClient}`
  const { json } = await fetchJson(url, { timeoutMs: (fetchOpts as any).timeoutMs ?? 15000, ...(fetchOpts as any), method: 'DELETE' })
  return json
}

export interface R2UsageResponse {
  checkQuota: boolean
  authed: boolean
  email?: string | null
  totalObjects: number
  totalBytes: number
  totalMB: number
  percent: number
  limitMB: number
  limitBytes: number
  warning: boolean
  truncated: boolean
  limits?: any
  guidance?: string
  objects?: { key: string; size: number; sizeKB?: number }[]
  error?: string
  driveQuota?: { usage: number; limit?: number; usageInDrive?: number; usageInDriveTrash?: number; source: 'live' | 'stub'; error?: string } | null
}

export async function fetchR2Usage(checkQuota: boolean = false, options: FetchOptions = {}): Promise<R2UsageResponse> {
  const url = checkQuota ? '/api/admin/r2-usage?checkQuota=true' : '/api/admin/r2-usage'
  const { json } = await fetchJson(url, { ...options, cache: 'no-store' } as any)
  return json as R2UsageResponse
}

export async function createBooking(payload: BookingPayload, options: FetchOptions = {}): Promise<BookingResponse> {
  const controller = new AbortController()
  const timeoutMs = options.timeoutMs ?? 8000
  const timeout = setTimeout(() => controller.abort(new Error(`timeout after ${timeoutMs}ms`)), timeoutMs)
  if (options.signal) {
    options.signal.addEventListener('abort', () => controller.abort(options.signal!.reason))
  }
  try {
    const res = await fetch('/api/booking', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        firstName: payload.firstName,
        lastName: payload.lastName,
        email: payload.email,
        phone: payload.phone,
        purpose: payload.purpose,
        slot: payload.slot,
        turnstileToken: payload.turnstileToken,
        confirmIntent: payload.confirmIntent,
        timeZone: payload.timeZone,
      }),
      signal: controller.signal,
    })
    const j = await res.json().catch(() => null)
    if (!res.ok) {
      throw new ApiError(`Request failed with ${res.status}`, res.status, j)
    }
    if (!j) throw new ApiError('Failed to parse booking response', res.status)
    return j as BookingResponse
  } catch (e: any) {
    if (e instanceof ApiError) throw e
    if (e?.name === 'AbortError' || e?.message?.toLowerCase().includes('abort') || e?.message?.includes('timeout')) {
      throw new Error(`Booking timeout after ${timeoutMs}ms: ${e.message}`)
    }
    throw new Error(`Network error: ${e.message || String(e)}`)
  } finally {
    clearTimeout(timeout)
  }
}

export async function lookupClientPortal(payload: { email: string; turnstileToken: string }, options: FetchOptions = {}): Promise<{ success: boolean; message: string }> {
  const res = await fetch('/api/client-portal/lookup', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
    ...options,
  })
  const json = await res.json()
  if (!res.ok) {
    throw new ApiError(`Request failed with ${res.status}`, res.status, json)
  }
  return json as { success: boolean; message: string }
}

