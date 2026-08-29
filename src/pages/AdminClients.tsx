import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../hooks/useAdminAuth'
import {
  searchAdminClientsGrouped,
  updateAdminDriveFolderClientLevel,
  sendAdminClientEmail,
  createManualBooking,
  deleteBooking,
  updateAdminClient,
  AdminClientCard,
  AdminClientRow,
} from '../lib/api'
import { toast } from 'react-hot-toast'

const US_TIMEZONES = [
  { value: '', label: 'Default (America/New_York)' },
  { value: 'America/New_York', label: 'Eastern — New York' },
  { value: 'America/Chicago', label: 'Central — Chicago' },
  { value: 'America/Denver', label: 'Mountain — Denver' },
  { value: 'America/Los_Angeles', label: 'Pacific — Los Angeles' },
  { value: 'America/Anchorage', label: 'Alaska — Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii — Honolulu' },
  { value: 'UTC', label: 'UTC' },
]

function isValidDriveFolderUrl(url: string): boolean {
  if (!url) return false
  const trimmed = url.trim()
  if (!trimmed.includes('/drive/folders/')) return false
  if (!trimmed.startsWith('https://')) return false
  try {
    const u = new URL(trimmed)
    if (u.protocol !== 'https:') return false
    const m = /\/folders\/([A-Za-z0-9-_]+)/.exec(trimmed)
    if (!m || !m[1] || m[1].length < 10) return false
    // R9 guard: never hyperlink stub rows persisted in dev (fake-/stub-/missing-)
    const id = m[1].toLowerCase()
    if (id.startsWith('fake-') || id.startsWith('stub-') || id.startsWith('missing-')) return false
    return true
  } catch {
    return false
  }
}

function formatNiceDateTime(iso?: string): string {
  if (!iso) return 'N/A'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function mapError(err: any): string {
  const status = err?.status
  const raw = (err?.body?.error || err?.message || '').toString()
  console.error('!!! ADMIN_CLIENTS_ERROR', { status, raw })
  if (status === 401) return 'Session expired — please sign in again.'
  if (status === 502 || raw.toLowerCase().includes('drive')) return 'Google Drive is temporarily unavailable — try again in a moment.'
  if (status === 429) return 'Too many requests — please wait and try again.'
  if (status === 400 && raw.toLowerCase().includes('past')) return 'Past meetings cannot be forwarded — select upcoming meetings only.'
  if (status === 400 && raw.toLowerCase().includes('drive')) return 'That Drive link looks invalid — use a /drive/folders/ link.'
  if (raw.toLowerCase().includes('network') || raw.toLowerCase().includes('failed to fetch')) return 'Network error — check your connection and try again.'
  // Keep generic for anti-enumeration but surface helpful fallback
  return raw ? raw.replace(/^[a-z_]+: /, '') : 'Something went wrong — try again.'
}

export default function AdminClients() {
  const { isAuthed, loading: authLoading } = useAdminAuth()
  const [q, setQ] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [clients, setClients] = useState<AdminClientCard[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [lastSearchParams, setLastSearchParams] = useState<{ q: string; startDate: string; endDate: string } | null>(null)

  const [editingDrive, setEditingDrive] = useState<Record<string, string>>({})
  const [driveErrors, setDriveErrors] = useState<Record<string, string>>({})
  const [savingDrive, setSavingDrive] = useState<Record<string, boolean>>({})
  const [sendingEmail, setSendingEmail] = useState<Record<string, boolean>>({})
  const [driveEditMode, setDriveEditMode] = useState<Record<string, boolean>>({})
  const [clientEditMode, setClientEditMode] = useState<Record<string, boolean>>({})
  const [editingClient, setEditingClient] = useState<Record<string, { first_name: string; last_name: string; phone: string }>>({})
  const [savingClient, setSavingClient] = useState<Record<string, boolean>>({})

  const [selected, setSelected] = useState<Record<string, Set<string>>>({})
  const [expandedPurpose, setExpandedPurpose] = useState<Record<string, boolean>>({})

  const [showAddModal, setShowAddModal] = useState(false)
  const [newBooking, setNewBooking] = useState({
    first_name: '',
    last_name: '',
    email: '',
    phone: '',
    purpose: '',
    slot_start: '',
    slot_end: '',
    time_zone: '',
    sendEmail: false,
  })
  const [newBookingErrors, setNewBookingErrors] = useState<Record<string, string>>({})
  const [deleteTarget, setDeleteTarget] = useState<{ client: AdminClientCard; meeting: AdminClientRow } | null>(null)
  const [cancelMeetingChecked, setCancelMeetingChecked] = useState(true)
  const [notifyClientChecked, setNotifyClientChecked] = useState(false)

  const addModalRef = useRef<HTMLDivElement>(null)
  const deleteModalRef = useRef<HTMLDivElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)
  const addFirstFieldRef = useRef<HTMLInputElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)

  // URL sync (7) — read on mount
  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlQ = params.get('q') || ''
    const urlStart = params.get('start_date') || ''
    const urlEnd = params.get('end_date') || ''
    if (urlQ || urlStart || urlEnd) {
      setQ(urlQ)
      setStartDate(urlStart)
      setEndDate(urlEnd)
      // Auto-search if URL has params — will be triggered by separate effect or manual? We'll trigger via flag
      setHasSearched(false)
    }
  }, [])

  const updateUrl = useCallback((qVal: string, startVal: string, endVal: string) => {
    const params = new URLSearchParams(window.location.search)
    if (qVal) params.set('q', qVal)
    else params.delete('q')
    if (startVal) params.set('start_date', startVal)
    else params.delete('start_date')
    if (endVal) params.set('end_date', endVal)
    else params.delete('end_date')
    const newUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState(null, '', newUrl)
  }, [])

  // Focus trap helper
  const trapFocus = useCallback((e: React.KeyboardEvent, modalRef: React.RefObject<HTMLDivElement | null>) => {
    if (e.key !== 'Tab') return
    const modal = modalRef.current
    if (!modal) return
    const focusable = modal.querySelectorAll<HTMLElement>(
      'a[href], button:not([disabled]), textarea, input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    const active = document.activeElement as HTMLElement
    if (e.shiftKey) {
      if (active === first) {
        e.preventDefault()
        last.focus()
      }
    } else {
      if (active === last) {
        e.preventDefault()
        first.focus()
      }
    }
  }, [])

  // Modal accessibility effects — autofocus, escape, return focus
  useEffect(() => {
    if (showAddModal) {
      // Autofocus first field (Add)
      setTimeout(() => addFirstFieldRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setShowAddModal(false)
        }
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [showAddModal])

  useEffect(() => {
    if (deleteTarget) {
      setTimeout(() => deleteCancelRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') {
          setDeleteTarget(null)
        }
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [deleteTarget])

  // Return focus to trigger on close
  useEffect(() => {
    if (!showAddModal && lastTriggerRef.current && document.activeElement?.closest('[role="dialog"]') == null) {
      // Only return focus if we closed add modal and trigger was add
      const el = lastTriggerRef.current
      if (el?.dataset?.trigger === 'add') {
        el.focus()
      }
    }
  }, [showAddModal])

  useEffect(() => {
    if (!deleteTarget && lastTriggerRef.current && lastTriggerRef.current.dataset?.trigger?.startsWith('delete-')) {
      lastTriggerRef.current.focus()
    }
  }, [deleteTarget])

  const handleOverlayClick = (e: React.MouseEvent, closer: () => void) => {
    if (e.target === e.currentTarget) {
      closer()
    }
  }

  const validateBookingForm = (): boolean => {
    const errs: Record<string, string> = {}
    if (!newBooking.first_name.trim()) errs.first_name = 'First name required'
    if (!newBooking.last_name.trim()) errs.last_name = 'Last name required'
    if (!newBooking.email.trim()) errs.email = 'Email required'
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newBooking.email.trim())) errs.email = 'Invalid email format'
    if (!newBooking.slot_start) errs.slot_start = 'Start time required'
    if (!newBooking.slot_end) errs.slot_end = 'End time required'
    if (newBooking.slot_start && newBooking.slot_end && new Date(newBooking.slot_start) >= new Date(newBooking.slot_end)) {
      errs.slot_end = 'End must be after start'
    }
    setNewBookingErrors(errs)
    if (Object.keys(errs).length > 0) {
      // Focus first invalid
      const firstKey = Object.keys(errs)[0]
      const el = document.getElementById(`add-${firstKey}`) as HTMLElement
      el?.focus()
      return false
    }
    return true
  }

  const handleSearch = async (e?: React.FormEvent, opts?: { forceClearSelection?: boolean }) => {
    e?.preventDefault()
    setSearchLoading(true)
    setHasSearched(true)
    const currentParams = { q, startDate, endDate }
    const shouldClearSelection = opts?.forceClearSelection ?? (JSON.stringify(currentParams) !== JSON.stringify(lastSearchParams))
    try {
      const data = await searchAdminClientsGrouped(q, { startDate, endDate })
      setClients(data)
      updateUrl(q, startDate, endDate)
      if (shouldClearSelection) {
        setSelected({})
      }
      setLastSearchParams(currentParams)
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSearchLoading(false)
    }
  }

  const handleCreateBooking = async (e?: React.FormEvent) => {
    e?.preventDefault()
    if (!validateBookingForm()) {
      toast.error('Fix the highlighted fields')
      return
    }
    setCreateLoading(true)
    try {
      const res = (await createManualBooking({
        ...newBooking,
        slot_start: new Date(newBooking.slot_start).toISOString(),
        slot_end: new Date(newBooking.slot_end).toISOString(),
        time_zone: newBooking.time_zone || undefined,
      })) as any
      const name = `${newBooking.first_name} ${newBooking.last_name}`.trim()
      const when = formatNiceDateTime(newBooking.slot_start)
      toast.success(`Booking created for ${name} — ${when}`)
      setShowAddModal(false)
      setNewBooking({ first_name: '', last_name: '', email: '', phone: '', purpose: '', slot_start: '', slot_end: '', time_zone: '', sendEmail: false })
      setNewBookingErrors({})
      // Refresh without wiping selection if q/dates didn't change
      const data = await searchAdminClientsGrouped(q, { startDate, endDate })
      setClients(data)
      setLastSearchParams({ q, startDate, endDate })
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setCreateLoading(false)
    }
  }

  const validateDriveLink = (contactId: string, url: string) => {
    const trimmed = url.trim()
    if (!trimmed) {
      setDriveErrors((prev) => ({ ...prev, [contactId]: '' }))
      return
    }
    if (!isValidDriveFolderUrl(trimmed)) {
      setDriveErrors((prev) => ({ ...prev, [contactId]: 'Must be a Drive folder link like https://drive.google.com/drive/folders/... (file links /file/d/ are not folders)' }))
    } else {
      setDriveErrors((prev) => ({ ...prev, [contactId]: '' }))
    }
  }

  const handleSaveDriveLink = async (contact_id: string) => {
    const url = editingDrive[contact_id]?.trim()
    if (!url) {
      toast.error('Drive URL required')
      return
    }
    if (!isValidDriveFolderUrl(url)) {
      toast.error('Invalid Drive folder URL — must be https://drive.google.com/drive/folders/...')
      setDriveErrors((prev) => ({ ...prev, [contact_id]: 'Invalid folder URL — use a /drive/folders/ link, not /file/d/' }))
      return
    }
    setSavingDrive((prev) => ({ ...prev, [contact_id]: true }))
    try {
      await updateAdminDriveFolderClientLevel(contact_id, url)
      toast.success('Drive link updated')
      setClients((prev) =>
        prev.map((c) => (c.contact_id === contact_id ? { ...c, drive_folder_url: url, drive_is_manual: 1 } : c))
      )
      setDriveErrors((prev) => ({ ...prev, [contact_id]: '' }))
      // Clear editing state after successful save — unsaved marker disappears (Tier3) + exit edit mode (R8a/R8b)
      setEditingDrive((prev) => {
        const next = { ...prev }
        delete next[contact_id]
        return next
      })
      setDriveEditMode((prev) => ({ ...prev, [contact_id]: false }))
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSavingDrive((prev) => ({ ...prev, [contact_id]: false }))
    }
  }

  const handleSaveClientEdit = async (contact_id: string) => {
    const draft = editingClient[contact_id]
    if (!draft) return
    const first = draft.first_name.trim()
    const last = draft.last_name.trim()
    if (!first || !last) {
      toast.error('First and last name required')
      return
    }
    setSavingClient((prev) => ({ ...prev, [contact_id]: true }))
    try {
      const res = await updateAdminClient(contact_id, { first_name: first, last_name: last, phone: draft.phone.trim() })
      toast.success('Client updated')
      setClients((prev) => prev.map((c) => (c.contact_id === contact_id ? { ...c, first_name: first, last_name: last, phone: draft.phone.trim() || undefined, meetings: c.meetings.map((m) => ({ ...m, first_name: first, last_name: last, phone: draft.phone.trim() || m.phone })) } : c)))
      setClientEditMode((prev) => ({ ...prev, [contact_id]: false }))
      setEditingClient((prev) => {
        const next = { ...prev }
        delete next[contact_id]
        return next
      })
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSavingClient((prev) => ({ ...prev, [contact_id]: false }))
    }
  }

  const toggleMeeting = (contactId: string, bookingId: string) => {
    setSelected((prev) => {
      const cur = prev[contactId] || new Set<string>()
      const next = new Set(cur)
      if (next.has(bookingId)) next.delete(bookingId)
      else next.add(bookingId)
      return { ...prev, [contactId]: next }
    })
  }

  function isUpcomingConfirmed(m: AdminClientRow): boolean {
    const confirmed = m.status === 'confirmed' || !m.status
    if (!confirmed) return false
    if (!m.slot_start) return false
    const t = new Date(m.slot_start).getTime()
    return !isNaN(t) && t >= Date.now() - 60_000
  }

  const toggleSelectAll = (client: AdminClientCard) => {
    const upcoming = client.meetings.filter(isUpcomingConfirmed)
    const cur = selected[client.contact_id]
    const allSelected = cur && upcoming.length > 0 && upcoming.every((m) => cur.has(m.booking_id!))
    setSelected((prev) => {
      const next = { ...prev }
      if (allSelected) {
        next[client.contact_id] = new Set<string>()
      } else {
        next[client.contact_id] = new Set(upcoming.map((m) => m.booking_id!).filter(Boolean))
      }
      return next
    })
  }

  // Tier2-5 Undo delete
  const [lastDeleted, setLastDeleted] = useState<{ client: AdminClientCard; meeting: AdminClientRow; prevClients: AdminClientCard[] } | null>(null)

  const handleSend = async (client: AdminClientCard) => {
    const bookingIds = Array.from(selected[client.contact_id] || [])
    if (bookingIds.length === 0) {
      toast.error('Tick at least one upcoming meeting to forward')
      return
    }
    setSendingEmail((prev) => ({ ...prev, [client.contact_id]: true }))
    try {
      const res = await sendAdminClientEmail(client.contact_id, bookingIds)
      const first = client.meetings.find((m) => bookingIds.includes(m.booking_id!))
      const when = first?.slot_start ? formatNiceDateTime(first.slot_start) : `${res.meetingsCount} meetings`
      toast.success(`Email sent to ${first ? `${client.first_name} ${client.last_name}` : res.sentTo} — ${when}`)
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSendingEmail((prev) => ({ ...prev, [client.contact_id]: false }))
    }
  }

  const handleSendSingle = async (client: AdminClientCard, bookingId: string) => {
    setSendingEmail((prev) => ({ ...prev, [client.contact_id]: true, [`${client.contact_id}:${bookingId}`]: true } as any))
    try {
      const res = await sendAdminClientEmail(client.contact_id, [bookingId])
      const row = client.meetings.find((m) => m.booking_id === bookingId)
      const when = row?.slot_start ? formatNiceDateTime(row.slot_start) : `${res.meetingsCount} meetings`
      toast.success(`Email sent to ${client.first_name} ${client.last_name} — ${when}`)
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSendingEmail((prev) => ({ ...prev, [client.contact_id]: false, [`${client.contact_id}:${bookingId}`]: false } as any))
    }
  }

  const handleDeleteBooking = async () => {
    if (!deleteTarget?.meeting.booking_id) return
    const target = deleteTarget
    const snapshot = clients
    setDeleteLoading(true)
    // Optimistic removal
    setClients((prev) =>
      prev.map((c) => (c.contact_id === target.client.contact_id ? { ...c, meetings: c.meetings.filter((m) => m.booking_id !== target.meeting.booking_id) } : c))
    )
    setDeleteTarget(null)
    setLastDeleted({ client: target.client, meeting: target.meeting, prevClients: snapshot })
    try {
      await deleteBooking(target.meeting.booking_id!, cancelMeetingChecked, { notifyClient: notifyClientChecked } as any)
      toast((t) => (
        <span className="flex items-center gap-2">
          Booking for {target.client.first_name} {target.client.last_name} deleted
          <button
            className="ml-2 underline font-semibold"
            onClick={async () => {
              toast.dismiss(t.id)
              // Undo: recreate via manual booking (Tier2-5)
              try {
                await createManualBooking({
                  first_name: target.client.first_name,
                  last_name: target.client.last_name,
                  email: target.client.email,
                  phone: target.client.phone || '',
                  purpose: target.meeting.purpose || '',
                  slot_start: target.meeting.slot_start || new Date().toISOString(),
                  slot_end: target.meeting.slot_end || new Date(Date.now() + 3600000).toISOString(),
                  time_zone: target.meeting.time_zone || 'America/New_York',
                  sendEmail: false,
                })
                toast.success('Booking restored')
              } catch {
                // Fallback: restore from snapshot if recreate fails
                setClients(snapshot)
                toast.success('Booking restored locally — please refresh to confirm')
              }
              const data = await searchAdminClientsGrouped(q, { startDate, endDate })
              setClients(data)
            }}
          >
            Undo
          </button>
        </span>
      ), { duration: 5000 })
    } catch (err: any) {
      // Rollback on failure
      setClients(snapshot)
      toast.error(mapError(err))
    } finally {
      setDeleteLoading(false)
    }
  }

  const getSortedMeetings = (meetings: AdminClientRow[]) => {
    const upcoming = meetings.filter(isUpcomingConfirmed).sort((a, b) => new Date(a.slot_start!).getTime() - new Date(b.slot_start!).getTime())
    const past = meetings.filter((m) => !isUpcomingConfirmed(m)).sort((a, b) => new Date(b.slot_start || 0).getTime() - new Date(a.slot_start || 0).getTime())
    return [...upcoming, ...past]
  }

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text)
      toast.success('Copied Drive link')
    } catch {
      toast.error('Copy failed')
    }
  }

  if (authLoading) return <div className="p-6">Loading...</div>
  if (!isAuthed) return <div className="p-6">Unauthorized</div>

  const totalMeetings = clients.reduce((acc, c) => acc + c.meetings.length, 0)

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="sticky top-0 bg-white p-4 border-b flex flex-wrap justify-between items-center gap-3 z-10 mb-2 rounded-t-xl">
        <h1 className="text-xl font-bold">Admin Client Portal</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-trigger="add"
            ref={lastTriggerRef as any}
            onClick={(e) => {
              lastTriggerRef.current = e.currentTarget as HTMLElement
              lastTriggerRef.current.dataset.trigger = 'add'
              setShowAddModal(true)
            }}
            className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-semibold min-h-11"
          >
            + Add Booking
          </button>
          <button type="button" onClick={() => (window.location.href = '/admin')} className="text-slate-600 text-sm underline min-h-11 px-2">
            Back to Admin
          </button>
          <a href="/" className="text-slate-600 text-sm underline min-h-11 inline-flex items-center px-2">
            View site
          </a>
        </div>
      </div>

      {showAddModal && (
        <div
          className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4"
          onClick={(e) => handleOverlayClick(e, () => setShowAddModal(false))}
          onKeyDown={(e: any) => {
            if (e.key === 'Escape') setShowAddModal(false)
            trapFocus(e, addModalRef)
          }}
        >
          <div
            ref={addModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="add-booking-title"
            className="bg-white p-6 rounded-2xl shadow w-full max-w-md max-h-[90vh] overflow-auto"
          >
            <h2 id="add-booking-title" className="text-lg font-bold mb-4">Add Booking</h2>
            <form onSubmit={handleCreateBooking} noValidate>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="add-first_name" className="text-xs font-medium">First name *</label>
                  <input
                    id="add-first_name"
                    ref={addFirstFieldRef}
                    placeholder="First name"
                    className={`border p-2 rounded ${newBookingErrors.first_name ? 'border-red-500' : ''}`}
                    value={newBooking.first_name}
                    onChange={(e) => setNewBooking({ ...newBooking, first_name: e.target.value })}
                    required
                    aria-invalid={!!newBookingErrors.first_name}
                    aria-describedby={newBookingErrors.first_name ? 'add-first_name-error' : undefined}
                  />
                  {newBookingErrors.first_name && <p id="add-first_name-error" className="text-xs text-red-600">{newBookingErrors.first_name}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="add-last_name" className="text-xs font-medium">Last name *</label>
                  <input
                    id="add-last_name"
                    placeholder="Last name"
                    className={`border p-2 rounded ${newBookingErrors.last_name ? 'border-red-500' : ''}`}
                    value={newBooking.last_name}
                    onChange={(e) => setNewBooking({ ...newBooking, last_name: e.target.value })}
                    required
                    aria-invalid={!!newBookingErrors.last_name}
                    aria-describedby={newBookingErrors.last_name ? 'add-last_name-error' : undefined}
                  />
                  {newBookingErrors.last_name && <p id="add-last_name-error" className="text-xs text-red-600">{newBookingErrors.last_name}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-email" className="text-xs font-medium">Email *</label>
                  <input
                    id="add-email"
                    type="email"
                    placeholder="client@example.com"
                    className={`border p-2 rounded ${newBookingErrors.email ? 'border-red-500' : ''}`}
                    value={newBooking.email}
                    onChange={(e) => setNewBooking({ ...newBooking, email: e.target.value })}
                    required
                    aria-invalid={!!newBookingErrors.email}
                    aria-describedby={newBookingErrors.email ? 'add-email-error' : undefined}
                  />
                  {newBookingErrors.email && <p id="add-email-error" className="text-xs text-red-600">{newBookingErrors.email}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-phone" className="text-xs font-medium">Phone</label>
                  <input
                    id="add-phone"
                    placeholder="Phone"
                    className="border p-2 rounded col-span-2"
                    value={newBooking.phone}
                    onChange={(e) => setNewBooking({ ...newBooking, phone: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-purpose" className="text-xs font-medium">Purpose</label>
                  <input
                    id="add-purpose"
                    placeholder="Tax filing, consultation…"
                    className="border p-2 rounded col-span-2"
                    value={newBooking.purpose}
                    onChange={(e) => setNewBooking({ ...newBooking, purpose: e.target.value })}
                  />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-slot_start" className="text-xs font-medium">Start *</label>
                  <input
                    id="add-slot_start"
                    type="datetime-local"
                    className={`border p-2 rounded ${newBookingErrors.slot_start ? 'border-red-500' : ''}`}
                    value={newBooking.slot_start}
                    onChange={(e) => setNewBooking({ ...newBooking, slot_start: e.target.value })}
                    required
                    aria-invalid={!!newBookingErrors.slot_start}
                  />
                  {newBookingErrors.slot_start && <p className="text-xs text-red-600">{newBookingErrors.slot_start}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-slot_end" className="text-xs font-medium">End *</label>
                  <input
                    id="add-slot_end"
                    type="datetime-local"
                    className={`border p-2 rounded ${newBookingErrors.slot_end ? 'border-red-500' : ''}`}
                    value={newBooking.slot_end}
                    onChange={(e) => setNewBooking({ ...newBooking, slot_end: e.target.value })}
                    required
                    aria-invalid={!!newBookingErrors.slot_end}
                  />
                  {newBookingErrors.slot_end && <p className="text-xs text-red-600">{newBookingErrors.slot_end}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="tz-select" className="text-xs font-medium">Timezone</label>
                  <select
                    id="tz-select"
                    className="border p-2 rounded col-span-2 text-sm"
                    value={newBooking.time_zone}
                    onChange={(e) => setNewBooking({ ...newBooking, time_zone: e.target.value })}
                    aria-label="Timezone"
                  >
                    {US_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm mt-2">
                  <input
                    type="checkbox"
                    checked={newBooking.sendEmail}
                    onChange={(e) => setNewBooking({ ...newBooking, sendEmail: e.target.checked })}
                  />
                  Send Confirmation Email
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">GDrive auto generated based on email+year, Meet auto generated from time</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-full border text-sm min-h-11">
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={createLoading}
                  className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50"
                >
                  {createLoading ? 'Creating…' : 'Create'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div
          className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4"
          onClick={(e) => handleOverlayClick(e, () => setDeleteTarget(null))}
          onKeyDown={(e: any) => {
            if (e.key === 'Escape') setDeleteTarget(null)
            trapFocus(e, deleteModalRef)
          }}
        >
          <div
            ref={deleteModalRef}
            role="dialog"
            aria-modal="true"
            aria-labelledby="delete-booking-title"
            className="bg-white p-6 rounded-2xl shadow w-full max-w-md"
          >
            <h2 id="delete-booking-title" className="text-lg font-bold mb-4">Confirm Delete</h2>
            <p className="mb-4 text-sm">
              Delete booking for {deleteTarget.client.first_name} {deleteTarget.client.last_name} at{' '}
              {deleteTarget.meeting.slot_start ? new Date(deleteTarget.meeting.slot_start).toLocaleString() : 'N/A'}? Drive folder will NOT be deleted.
            </p>
            <label className="flex items-center gap-2 mb-2 text-sm">
              <input type="checkbox" checked={cancelMeetingChecked} onChange={(e) => setCancelMeetingChecked(e.target.checked)} />
              Cancel meeting and free calendar?
            </label>
            <label className="flex items-center gap-2 mb-4 text-sm">
              <input type="checkbox" checked={notifyClientChecked} onChange={(e) => setNotifyClientChecked(e.target.checked)} />
              Notify client by email?
            </label>
            <div className="flex justify-end gap-2">
              <button ref={deleteCancelRef} type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-full border text-sm min-h-11">
                Keep booking
              </button>
              <button type="button" onClick={handleDeleteBooking} disabled={deleteLoading} className="bg-red-600 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">
                {deleteLoading ? 'Deleting…' : 'Delete'}
              </button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={(e) => handleSearch(e, { forceClearSelection: true })} className="my-4 p-4 border rounded-xl flex flex-wrap gap-3 items-end bg-slate-50">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="q" className="block text-sm font-medium mb-1">
            Search
          </label>
          <input
            id="q"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Email, first name, last name, or Drive link"
            className="border p-2 rounded w-full"
          />
        </div>
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium mb-1">
            From
          </label>
          <input
            id="startDate"
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium mb-1">
            To
          </label>
          <input
            id="endDate"
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="border p-2 rounded"
          />
        </div>
        <button type="submit" disabled={searchLoading} className="bg-slate-900 text-white px-5 py-2 rounded-full text-sm font-semibold min-h-11 disabled:opacity-50">
          {searchLoading ? 'Searching…' : 'Search'}
        </button>
      </form>

      {!hasSearched && !clients.length ? (
        <div className="border rounded-xl p-8 text-center bg-white">
          <p className="text-sm text-slate-600">Enter a search to find clients — by email, name, or paste a Drive folder link.</p>
        </div>
      ) : hasSearched && !clients.length ? (
        <p className="text-sm text-slate-500 border rounded-xl p-6 text-center">No clients matched. Check spelling or try a broader search — or the client may not exist yet. Add a booking to create them.</p>
      ) : (
        <>
          {hasSearched && (
            <p className="text-sm text-slate-700 mb-2">
              {clients.length} client{clients.length !== 1 ? 's' : ''} found, {totalMeetings} meeting{totalMeetings !== 1 ? 's' : ''} total
            </p>
          )}
          {clients.length >= 50 && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">Showing first 50 contacts — refine search for more.</p>
          )}
          {clients.some((c) => c.meetings.length >= 500) && (
            <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">Some clients have 500+ meetings — only first 500 shown.</p>
          )}
          <p className="text-xs text-slate-500 mb-2">Only upcoming meetings can be forwarded. Past meetings are shown but cannot be selected.</p>
          <div className="space-y-6">
            {clients.map((client) => {
              const selSet = selected[client.contact_id] || new Set<string>()
              const selCount = selSet.size
              const upcomingCount = client.meetings.filter(isUpcomingConfirmed).length
              const sortedMeetings = getSortedMeetings(client.meetings)
              const isSaving = !!savingDrive[client.contact_id]
              const isSending = !!sendingEmail[client.contact_id]
              const currentDrive = client.drive_folder_url || ''
              const editedDrive = editingDrive[client.contact_id]
              const isUnsaved = editedDrive !== undefined && editedDrive !== currentDrive
              return (
                <div key={client.contact_id} className="border rounded-2xl overflow-hidden bg-white">
                  <div className="p-4 bg-slate-50 border-b flex flex-wrap justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      {clientEditMode[client.contact_id] ? (
                        <div className="flex flex-wrap gap-2 items-end">
                          <div className="flex flex-col">
                            <label className="text-[10px] text-slate-500">First name</label>
                            <input value={editingClient[client.contact_id]?.first_name ?? client.first_name} onChange={(e) => setEditingClient((prev) => ({ ...prev, [client.contact_id]: { ...(prev[client.contact_id] || { first_name: client.first_name, last_name: client.last_name, phone: client.phone || '' }), first_name: e.target.value } }))} className="border p-1.5 rounded text-sm w-[120px]" />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-[10px] text-slate-500">Last name</label>
                            <input value={editingClient[client.contact_id]?.last_name ?? client.last_name} onChange={(e) => setEditingClient((prev) => ({ ...prev, [client.contact_id]: { ...(prev[client.contact_id] || { first_name: client.first_name, last_name: client.last_name, phone: client.phone || '' }), last_name: e.target.value } }))} className="border p-1.5 rounded text-sm w-[120px]" />
                          </div>
                          <div className="flex flex-col">
                            <label className="text-[10px] text-slate-500">Phone</label>
                            <input value={editingClient[client.contact_id]?.phone ?? client.phone ?? ''} onChange={(e) => setEditingClient((prev) => ({ ...prev, [client.contact_id]: { ...(prev[client.contact_id] || { first_name: client.first_name, last_name: client.last_name, phone: client.phone || '' }), phone: e.target.value } }))} className="border p-1.5 rounded text-sm w-[140px]" placeholder="Phone" />
                          </div>
                          <button type="button" onClick={() => handleSaveClientEdit(client.contact_id)} disabled={!!savingClient[client.contact_id]} className="bg-blue-600 text-white px-3 py-1.5 rounded-full text-xs font-semibold min-h-8 disabled:opacity-50">{savingClient[client.contact_id] ? 'Saving…' : 'Save'}</button>
                          <button type="button" onClick={() => { setClientEditMode((prev) => ({ ...prev, [client.contact_id]: false })); setEditingClient((prev) => { const n = { ...prev }; delete n[client.contact_id]; return n }) }} className="border px-3 py-1.5 rounded-full text-xs min-h-8">Cancel</button>
                          <div className="w-full text-[11px] text-slate-500">Email is the Drive folder name and cannot be edited here — {client.email}</div>
                        </div>
                      ) : (
                        <>
                          <div className="font-semibold truncate flex items-center gap-2">
                            <span>{client.first_name} {client.last_name} · <span className="break-all">{client.email}</span>{client.phone ? ` · ${client.phone}` : ''}</span>
                            <button type="button" onClick={() => { setClientEditMode((prev) => ({ ...prev, [client.contact_id]: true })); setEditingClient((prev) => ({ ...prev, [client.contact_id]: { first_name: client.first_name, last_name: client.last_name, phone: client.phone || '' } })) }} className="text-xs text-blue-600 underline ml-2" aria-label={`Edit ${client.email}`}>Edit</button>
                          </div>
                          {client.year_folders.length > 0 && (
                            <div className="text-xs text-slate-500 mt-1">
                              Year folders:{' '}
                              {client.year_folders.map((y) => (
                                <a key={`${y.year}-${y.folder_id}`} href={y.folder_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mr-2">
                                  {y.year} ↗
                                </a>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <button
                        type="button"
                        data-testid={`send-${client.contact_id}`}
                        onClick={() => handleSend(client)}
                        disabled={selCount === 0 || isSending}
                        aria-label={`Send ${selCount} selected meetings to ${client.email}`}
                        className="bg-green-600 text-white px-4 py-2 rounded-full text-sm font-semibold min-h-11 disabled:opacity-40 disabled:cursor-not-allowed"
                      >
                        {isSending ? 'Sending…' : `Send selected (${selCount})`}
                      </button>
                      {selCount === 0 && upcomingCount > 0 && (
                        <span className="text-[11px] text-slate-500">Tick upcoming meetings to forward</span>
                      )}
                      {upcomingCount === 0 && (
                        <span className="text-[11px] text-slate-500">No upcoming meetings to send</span>
                      )}
                    </div>
                  </div>
                  {(() => {
                    const isEdit = !!driveEditMode[client.contact_id]
                    const hasValidLink = currentDrive && isValidDriveFolderUrl(currentDrive)
                    const displayUrl = editingDrive[client.contact_id] !== undefined ? editingDrive[client.contact_id] : currentDrive
                    const handleEnterEdit = () => {
                      setDriveEditMode((prev) => ({ ...prev, [client.contact_id]: true }))
                      setEditingDrive((prev) => ({ ...prev, [client.contact_id]: currentDrive }))
                    }
                    const handleCancelEdit = () => {
                      setDriveEditMode((prev) => ({ ...prev, [client.contact_id]: false }))
                      setEditingDrive((prev) => {
                        const next = { ...prev }
                        delete next[client.contact_id]
                        return next
                      })
                      setDriveErrors((prev) => ({ ...prev, [client.contact_id]: '' }))
                    }
                    if (!isEdit) {
                      return (
                        <div className="p-3 flex flex-wrap gap-2 items-center border-b bg-white">
                          <span className="text-xs font-medium text-slate-600">GDrive:</span>
                          {hasValidLink ? (
                            <a href={currentDrive} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline truncate max-w-[360px]" title={currentDrive}>
                              {currentDrive}
                            </a>
                          ) : currentDrive ? (
                            <span className="text-sm text-slate-500 truncate max-w-[360px]" title={currentDrive}>{currentDrive} (invalid)</span>
                          ) : (
                            <span className="text-sm text-slate-500">No Drive link</span>
                          )}
                          <div className="flex gap-1 items-center ml-2">
                            {hasValidLink && (
                              <button type="button" onClick={() => copyToClipboard(currentDrive)} aria-label={`Copy Drive link for ${client.email}`} className="text-slate-600 border px-2 py-1.5 rounded text-xs min-h-8" title="Copy Drive link">Copy</button>
                            )}
                            <button type="button" onClick={handleEnterEdit} aria-label={hasValidLink ? `Edit Drive link for ${client.email}` : `Add Drive link for ${client.email}`} className="text-white bg-blue-600 px-3 py-1.5 rounded-full text-xs font-semibold min-h-8">
                              {hasValidLink ? 'Edit' : '+ Add Drive link'}
                            </button>
                          </div>
                          {client.drive_is_manual ? <span className="text-[10px] bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">✎ manual</span> : null}
                        </div>
                      )
                    }
                    return (
                      <div className="p-3 flex flex-wrap gap-2 items-start border-b bg-white">
                        <label htmlFor={`drive-${client.contact_id}`} className="text-xs font-medium text-slate-600 mt-2">GDrive:</label>
                        <div className="flex-1 min-w-[280px]">
                          <div className="flex gap-1">
                            <input
                              id={`drive-${client.contact_id}`}
                              value={displayUrl || ''}
                              onChange={(e) => setEditingDrive({ ...editingDrive, [client.contact_id]: e.target.value })}
                              onBlur={(e) => validateDriveLink(client.contact_id, e.target.value)}
                              placeholder="https://drive.google.com/drive/folders/..."
                              className={`border p-2 rounded text-sm w-full ${driveErrors[client.contact_id] ? 'border-red-400' : ''} ${isUnsaved ? 'bg-amber-50' : ''}`}
                              aria-label={`Drive folder URL for ${client.email}`}
                              aria-describedby={driveErrors[client.contact_id] ? `drive-err-${client.contact_id}` : undefined}
                            />
                            {currentDrive && (
                              <button type="button" onClick={() => copyToClipboard(editingDrive[client.contact_id] ?? currentDrive)} aria-label={`Copy Drive link for ${client.email}`} className="text-slate-600 border px-2 py-2 rounded text-xs min-h-11" title="Copy Drive link">Copy</button>
                            )}
                          </div>
                          {driveErrors[client.contact_id] && <p id={`drive-err-${client.contact_id}`} className="text-xs text-red-600 mt-1">{driveErrors[client.contact_id]}</p>}
                          {isUnsaved && !driveErrors[client.contact_id] && <p className="text-[11px] text-amber-700 mt-1">Unsaved changes</p>}
                        </div>
                        <button type="button" onClick={() => handleSaveDriveLink(client.contact_id)} disabled={isSaving} aria-label={`Save Drive link for ${client.email}`} className="text-white bg-blue-600 px-4 py-2 rounded-full text-xs font-semibold min-h-11 disabled:opacity-50 mt-0.5">{isSaving ? 'Saving…' : 'Save'}</button>
                        <button type="button" onClick={handleCancelEdit} className="border px-4 py-2 rounded-full text-xs min-h-11 mt-0.5">Cancel</button>
                        {client.drive_is_manual ? <span className="text-[10px] bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 mt-2">✎ manual</span> : null}
                      </div>
                    )
                  })()}

                  {client.meetings.length === 0 ? (
                    <p className="text-sm text-slate-500 p-4">No meetings in the selected range.</p>
                  ) : (
                    <>
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <caption className="sr-only">Meetings for {client.email}</caption>
                          <thead>
                            <tr className="border-b bg-slate-50/50 text-xs text-slate-500">
                              <th className="p-2 w-8" scope="col">
                                <input
                                  type="checkbox"
                                  data-testid="select-all"
                                  aria-label={`Select all upcoming meetings for ${client.email}`}
                                  checked={(() => {
                                    const up = client.meetings.filter(isUpcomingConfirmed)
                                    return up.length > 0 && up.every((m) => selSet.has(m.booking_id!))
                                  })()}
                                  onChange={() => toggleSelectAll(client)}
                                />
                              </th>
                              <th className="p-2 text-left" scope="col">Meeting Time</th>
                              <th className="p-2 text-left" scope="col">Purpose</th>
                              <th className="p-2 text-left" scope="col">Timezone</th>
                              <th className="p-2 text-left" scope="col">Meeting URL</th>
                              <th className="p-2 text-left" scope="col">Status</th>
                              <th className="p-2 text-left" scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedMeetings.map((r) => {
                              const canSelect = isUpcomingConfirmed(r)
                              return (
                                <tr key={r.booking_id || `${r.contact_id}-no-id`} className="border-b">
                                  <td className="p-2">
                                    {r.booking_id ? (
                                      <input
                                        type="checkbox"
                                        data-booking-id={r.booking_id}
                                        data-testid={`meeting-${r.booking_id}`}
                                        disabled={!canSelect}
                                        aria-label={`${canSelect ? 'Select' : 'Past meeting (cannot select)'} ${r.slot_start ? new Date(r.slot_start).toLocaleDateString() : ''}`}
                                        checked={selSet.has(r.booking_id!)}
                                        onChange={() => toggleMeeting(client.contact_id, r.booking_id!)}
                                      />
                                    ) : null}
                                  </td>
                                  <td className="p-2 whitespace-nowrap">{r.slot_start ? new Date(r.slot_start).toLocaleString() : '-'}</td>
                                  <td className="p-2">
                                    {(() => {
                                      const p = r.purpose || ''
                                      if (!p) return <span className="text-slate-400">—</span>
                                      const id = r.booking_id || `${r.contact_id}-${r.slot_start}`
                                      const expanded = !!expandedPurpose[id]
                                      const needsClamp = p.length > 100
                                      return (
                                        <div className="max-w-[280px]">
                                          <span title={p}>{needsClamp && !expanded ? p.slice(0, 100) + '…' : p}</span>
                                          {needsClamp && (
                                            <button type="button" onClick={() => setExpandedPurpose((prev) => ({ ...prev, [id]: !prev[id] }))} className="ml-1 text-xs text-blue-600 underline">{expanded ? 'Show less' : 'Show more'}</button>
                                          )}
                                        </div>
                                      )
                                    })()}
                                  </td>
                                  <td className="p-2">{r.time_zone || ''}</td>
                                  <td className="p-2 text-xs truncate max-w-[140px]">
                                    {r.meet_link ? (
                                      <a href={r.meet_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">
                                        {r.meet_link.slice(0, 40)}…
                                      </a>
                                    ) : (
                                      <span className="text-slate-500">Not recorded</span>
                                    )}
                                  </td>
                                  <td className="p-2 text-xs">{r.status || ''}</td>
                                  <td className="p-2">
                                    <div className="flex items-center gap-1">
                                      {r.booking_id && canSelect && (
                                        <button
                                          type="button"
                                          onClick={() => handleSendSingle(client, r.booking_id!)}
                                          aria-label={`Send meeting at ${r.slot_start} to ${client.email}`}
                                          title="Send this meeting"
                                          className="w-8 h-8 inline-flex items-center justify-center bg-white border border-slate-300 rounded-full hover:bg-slate-50 disabled:opacity-40"
                                          disabled={!!sendingEmail[client.contact_id]}
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
                                        </button>
                                      )}
                                      {r.booking_id && (
                                        <button
                                          type="button"
                                          onClick={(e) => {
                                            lastTriggerRef.current = e.currentTarget as HTMLElement
                                            lastTriggerRef.current.dataset.trigger = `delete-${r.booking_id}`
                                            setDeleteTarget({ client, meeting: r })
                                            setCancelMeetingChecked(true)
                                            setNotifyClientChecked(false)
                                          }}
                                          aria-label={`Delete booking for ${client.email} at ${r.slot_start}`}
                                          title="Delete booking"
                                          className="w-8 h-8 inline-flex items-center justify-center bg-red-600 text-white rounded-full text-xs hover:bg-red-700"
                                        >
                                          <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                        </button>
                                      )}
                                    </div>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="sm:hidden divide-y">
                        {sortedMeetings.map((r) => {
                          const canSelect = isUpcomingConfirmed(r)
                          return (
                            <div key={r.booking_id || `${r.contact_id}-no-id`} className="p-3 flex gap-3">
                              {r.booking_id ? (
                                <input
                                  type="checkbox"
                                  data-booking-id={r.booking_id}
                                  data-testid={`meeting-${r.booking_id}-mobile`}
                                  disabled={!canSelect}
                                  aria-label={`${canSelect ? 'Select' : 'Past meeting'} ${r.slot_start}`}
                                  checked={selSet.has(r.booking_id!)}
                                  onChange={() => toggleMeeting(client.contact_id, r.booking_id!)}
                                  className="mt-1"
                                />
                              ) : null}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{r.slot_start ? new Date(r.slot_start).toLocaleString() : '-'}</div>
                                <div className="text-xs text-slate-500">
                                  {(() => {
                                    const p = r.purpose || 'No purpose'
                                    const id = (r.booking_id || `${r.contact_id}-${r.slot_start}`) + '-m'
                                    const expanded = !!expandedPurpose[id]
                                    const needsClamp = p.length > 80
                                    return (
                                      <>
                                        <span title={p}>{needsClamp && !expanded ? p.slice(0, 80) + '…' : p}</span>
                                        {needsClamp && <button type="button" onClick={() => setExpandedPurpose((prev) => ({ ...prev, [id]: !prev[id] }))} className="ml-1 text-blue-600 underline">{expanded ? 'less' : 'more'}</button>}
                                        {' · '}{r.time_zone || 'N/A'} · {r.status || ''}
                                      </>
                                    )
                                  })()}
                                </div>
                                {r.meet_link && <a href={r.meet_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline break-all">{r.meet_link}</a>}
                                {!canSelect && <div className="text-[11px] text-slate-500 mt-1">Past meeting — cannot be forwarded</div>}
                                <div className="mt-2 flex gap-2">
                                  {r.booking_id && canSelect && (
                                    <button
                                      type="button"
                                      onClick={() => handleSendSingle(client, r.booking_id!)}
                                      aria-label={`Send meeting at ${r.slot_start} to ${client.email}`}
                                      title="Send this meeting"
                                      className="w-8 h-8 inline-flex items-center justify-center bg-white border rounded-full"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z" /><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z" /></svg>
                                    </button>
                                  )}
                                  {r.booking_id && (
                                    <button
                                      type="button"
                                      onClick={(e) => {
                                        lastTriggerRef.current = e.currentTarget as HTMLElement
                                        lastTriggerRef.current.dataset.trigger = `delete-${r.booking_id}-mobile`
                                        setDeleteTarget({ client, meeting: r })
                                        setCancelMeetingChecked(true)
                                        setNotifyClientChecked(false)
                                      }}
                                      aria-label={`Delete booking for ${client.email} at ${r.slot_start}`}
                                      title="Delete booking"
                                      className="w-8 h-8 inline-flex items-center justify-center bg-red-600 text-white rounded-full text-xs"
                                    >
                                      <svg xmlns="http://www.w3.org/2000/svg" className="w-4 h-4" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M9 2a1 1 0 00-.894.553L7.382 4H4a1 1 0 000 2v10a2 2 0 002 2h8a2 2 0 002-2V6a1 1 0 100-2h-3.382l-.724-1.447A1 1 0 0011 2H9zM7 8a1 1 0 012 0v6a1 1 0 11-2 0V8zm5-1a1 1 0 00-1 1v6a1 1 0 102 0V8a1 1 0 00-1-1z" clipRule="evenodd" /></svg>
                                    </button>
                                  )}
                                </div>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    </>
                  )}
                </div>
              )
            })}
          </div>
        </>
      )}
    </div>
  )
}
