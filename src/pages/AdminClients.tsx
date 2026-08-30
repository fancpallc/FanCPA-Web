import React, { useState, useRef, useEffect, useCallback } from 'react'
import { useAdminAuth } from '../hooks/useAdminAuth'
import {
  searchAdminClientsGrouped,
  updateAdminDriveFolderClientLevel,
  sendAdminClientEmail,
  createManualBooking,
  cancelAdminBooking,
  hideAdminBooking,
  unhideAdminBooking,
  rebookAdminBooking,
  updateAdminClient,
  AdminClientCard,
  AdminClientRow,
} from '../lib/api'
import { toast } from 'react-hot-toast'

const US_TIMEZONES = [
  { value: '', label: 'Default (America/New_York)' },
  { value: 'America/New_York', label: 'Eastern - New York' },
  { value: 'America/Chicago', label: 'Central - Chicago' },
  { value: 'America/Denver', label: 'Mountain - Denver' },
  { value: 'America/Los_Angeles', label: 'Pacific - Los Angeles' },
  { value: 'America/Anchorage', label: 'Alaska - Anchorage' },
  { value: 'Pacific/Honolulu', label: 'Hawaii - Honolulu' },
  { value: 'UTC', label: 'UTC' },
]

function isValidDriveFolderUrl(url: string): boolean {
  if (!url) return false
  const trimmed = url.trim()
  if (!trimmed.includes('/drive/folders/')) return false
  if (!trimmed.startsWith('https://')) return false
  try {
    const m = /\/folders\/([A-Za-z0-9-_]+)/.exec(trimmed)
    if (!m || !m[1] || m[1].length < 10) return false
    const id = m[1].toLowerCase()
    if (id.startsWith('fake-') || id.startsWith('stub-') || id.startsWith('missing-')) return false
    return true
  } catch {
    return false
  }
}

function formatNiceDateTime(iso?: string, tz?: string): string {
  if (!iso) return 'N/A'
  try {
    return new Date(iso).toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit',
      hour12: true,
      timeZone: tz || undefined,
      timeZoneName: 'short',
    })
  } catch {
    return iso
  }
}

function isoToDatetimeLocal(iso?: string): string {
  if (!iso) return ''
  try {
    const d = new Date(iso)
    if (isNaN(d.getTime())) return ''
    const pad = (n: number) => String(n).padStart(2, '0')
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
  } catch {
    return ''
  }
}

function mapError(err: any): string {
  const status = err?.status
  const raw = (err?.body?.error || err?.message || '').toString()
  const lower = raw.toLowerCase()
  if (status === 401) return 'Session expired - please sign in again.'
  if (status === 502 || lower.includes('drive')) return 'Google Drive is temporarily unavailable - try again in a moment.'
  if (status === 429) return 'Too many requests - please wait and try again.'
  if (status === 400 && lower.includes('past')) return 'Past meetings cannot be forwarded - select upcoming meetings only.'
  if (status === 400 && lower.includes('drive')) return 'That Drive link looks invalid - use a /drive/folders/ link.'
  if (lower.includes('booking_ids must belong') || lower.includes('must belong to contact_id')) return 'Some selected meetings don’t belong to this client or aren’t upcoming — select only upcoming meetings for this client, or if you selected cancelled/completed use Hide instead of Send.'
  if (lower.includes('network') || lower.includes('failed to fetch')) return 'Network error - check your connection and try again.'
  return raw ? raw.replace(/^[a-z_]+: /, '') : 'Something went wrong - try again.'
}

type RowStatus = 'upcoming' | 'completed' | 'cancelled' | 'hidden'

function isUpcomingConfirmed(m: AdminClientRow): boolean {
  if ((m as any).deleted_at) return false
  const confirmed = m.status === 'confirmed' || !m.status
  if (!confirmed) return false
  // Use slot_end so meeting in progress stays upcoming until it actually ends
  const endIso = (m as any).slot_end || m.slot_start
  if (!endIso) return false
  const t = new Date(endIso).getTime()
  return !isNaN(t) && t >= Date.now() - 60_000
}

function getRowStatus(m: AdminClientRow): RowStatus {
  if ((m as any).deleted_at) return 'hidden'
  if (m.status === 'cancelled') return 'cancelled'
  const endIso = (m as any).slot_end
  const startIso = m.slot_start
  if (!endIso && !startIso) return 'completed'
  // Prefer slot_end for completed boundary
  if (endIso) {
    const te = new Date(endIso).getTime()
    if (!isNaN(te) && te < Date.now() - 60_000) return 'completed'
    return 'upcoming'
  }
  const ts = new Date(startIso!).getTime()
  if (isNaN(ts) || ts < Date.now() - 60_000) return 'completed'
  return 'upcoming'
}

function getStatusChip(status: RowStatus) {
  switch (status) {
    case 'upcoming':
      // P1 fix: was bg-slate-100 identical to completed's bg-gray-100 (both #f1f5f9) — invisible distinction
      return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-blue-50 text-blue-600 border border-blue-300">Upcoming</span>
    case 'completed':
      return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-gray-200 text-gray-600 border">Completed</span>
    case 'cancelled':
      return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-red-50 text-red-700 border border-red-200">Cancelled</span>
    case 'hidden':
      return <span className="inline-flex px-2 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 text-amber-800 border border-amber-200">Hidden</span>
  }
}

export default function AdminClients() {
  const { isAuthed, loading: authLoading } = useAdminAuth()
  const [q, setQ] = useState('')
  const [startDate, setStartDate] = useState('')
  const [endDate, setEndDate] = useState('')
  const [showHidden, setShowHidden] = useState(false)
  const [clients, setClients] = useState<AdminClientCard[]>([])
  const [searchLoading, setSearchLoading] = useState(false)
  const [createLoading, setCreateLoading] = useState(false)
  const [deleteLoading, setDeleteLoading] = useState(false)
  const [hasSearched, setHasSearched] = useState(false)
  const [lastSearchParams, setLastSearchParams] = useState<{ q: string; startDate: string; endDate: string; showHidden: boolean } | null>(null)

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
  const [deleteTarget, setDeleteTarget] = useState<{ client: AdminClientCard; meeting: AdminClientRow; mode: 'cancel' | 'hide' } | null>(null)
  const [bulkHideTarget, setBulkHideTarget] = useState<{ client: AdminClientCard; meetings: AdminClientRow[] } | null>(null)
  const [rebookTarget, setRebookTarget] = useState<{ client: AdminClientCard; meeting: AdminClientRow } | null>(null)
  const [rebookForm, setRebookForm] = useState<{ slot_start: string; slot_end: string; time_zone: string }>({ slot_start: '', slot_end: '', time_zone: '' })
  const [rebookErrors, setRebookErrors] = useState<Record<string, string>>({})
  const [notifyClientChecked, setNotifyClientChecked] = useState(true)

  const addModalRef = useRef<HTMLDivElement>(null)
  const deleteModalRef = useRef<HTMLDivElement>(null)
  const bulkHideModalRef = useRef<HTMLDivElement>(null)
  const rebookModalRef = useRef<HTMLDivElement>(null)
  const lastTriggerRef = useRef<HTMLElement | null>(null)
  const addFirstFieldRef = useRef<HTMLInputElement>(null)
  const deleteCancelRef = useRef<HTMLButtonElement>(null)
  const bulkHideCancelRef = useRef<HTMLButtonElement>(null)
  const rebookCancelRef = useRef<HTMLButtonElement>(null)

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    const urlQ = params.get('q') || ''
    const urlStart = params.get('start_date') || ''
    const urlEnd = params.get('end_date') || ''
    const urlHidden = params.get('showHidden') === 'true'
    if (urlQ || urlStart || urlEnd || urlHidden) {
      setQ(urlQ)
      setStartDate(urlStart)
      setEndDate(urlEnd)
      setShowHidden(urlHidden)
      setHasSearched(false)
    }
  }, [])

  const updateUrl = useCallback((qVal: string, startVal: string, endVal: string, hidden: boolean) => {
    const params = new URLSearchParams(window.location.search)
    if (qVal) params.set('q', qVal)
    else params.delete('q')
    if (startVal) params.set('start_date', startVal)
    else params.delete('start_date')
    if (endVal) params.set('end_date', endVal)
    else params.delete('end_date')
    if (hidden) params.set('showHidden', 'true')
    else params.delete('showHidden')
    const newUrl = `${window.location.pathname}?${params.toString()}`
    window.history.replaceState(null, '', newUrl)
  }, [])

  useEffect(() => {
    if (hasSearched) {
      handleSearch(undefined, { forceClearSelection: false })
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [showHidden])

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

  useEffect(() => {
    if (showAddModal) {
      setTimeout(() => addFirstFieldRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setShowAddModal(false)
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [showAddModal])

  useEffect(() => {
    if (deleteTarget) {
      setTimeout(() => deleteCancelRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setDeleteTarget(null)
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [deleteTarget])

  useEffect(() => {
    if (bulkHideTarget) {
      setTimeout(() => bulkHideCancelRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setBulkHideTarget(null)
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [bulkHideTarget])

  useEffect(() => {
    if (rebookTarget) {
      setTimeout(() => rebookCancelRef.current?.focus(), 0)
      const onKey = (e: KeyboardEvent) => {
        if (e.key === 'Escape') setRebookTarget(null)
      }
      document.addEventListener('keydown', onKey)
      return () => document.removeEventListener('keydown', onKey)
    }
  }, [rebookTarget])

  useEffect(() => {
    if (!showAddModal && lastTriggerRef.current && document.activeElement?.closest('[role="dialog"]') == null) {
      const el = lastTriggerRef.current
      if (el?.dataset?.trigger === 'add') el.focus()
    }
  }, [showAddModal])

  useEffect(() => {
    if (!deleteTarget && lastTriggerRef.current && lastTriggerRef.current.dataset?.trigger?.startsWith('delete-')) {
      lastTriggerRef.current.focus()
    }
  }, [deleteTarget])

  useEffect(() => {
    if (!bulkHideTarget && lastTriggerRef.current && lastTriggerRef.current.dataset?.trigger?.startsWith('bulk-hide-')) {
      lastTriggerRef.current.focus()
    }
  }, [bulkHideTarget])

  useEffect(() => {
    if (!rebookTarget && lastTriggerRef.current && lastTriggerRef.current.dataset?.trigger?.startsWith('rebook-')) {
      lastTriggerRef.current.focus()
    }
  }, [rebookTarget])

  const handleOverlayClick = (e: React.MouseEvent, closer: () => void) => {
    if (e.target === e.currentTarget) closer()
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
    const currentParams = { q, startDate, endDate, showHidden }
    const shouldClearSelection = opts?.forceClearSelection ?? (JSON.stringify(currentParams) !== JSON.stringify(lastSearchParams))
    try {
      const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
      setClients(data)
      updateUrl(q, startDate, endDate, showHidden)
      if (shouldClearSelection) setSelected({})
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
      const when = formatNiceDateTime(newBooking.slot_start, newBooking.time_zone)
      toast.success(`Booking created for ${name} - ${when}`)
      setShowAddModal(false)
      setNewBooking({ first_name: '', last_name: '', email: '', phone: '', purpose: '', slot_start: '', slot_end: '', time_zone: '', sendEmail: false })
      setNewBookingErrors({})
      const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
      setClients(data)
      setLastSearchParams({ q, startDate, endDate, showHidden })
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
      toast.error('Invalid Drive folder URL - must be https://drive.google.com/drive/folders/...')
      setDriveErrors((prev) => ({ ...prev, [contact_id]: 'Invalid folder URL - use a /drive/folders/ link, not /file/d/' }))
      return
    }
    setSavingDrive((prev) => ({ ...prev, [contact_id]: true }))
    try {
      await updateAdminDriveFolderClientLevel(contact_id, url)
      toast.success('Drive link updated')
      setClients((prev) => prev.map((c) => (c.contact_id === contact_id ? { ...c, drive_folder_url: url, drive_is_manual: 1 } : c)))
      setDriveErrors((prev) => ({ ...prev, [contact_id]: '' }))
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
      await updateAdminClient(contact_id, { first_name: first, last_name: last, phone: draft.phone.trim() })
      toast.success('Client updated')
      setClients((prev) =>
        prev.map((c) =>
          c.contact_id === contact_id
            ? { ...c, first_name: first, last_name: last, phone: draft.phone.trim() || undefined, meetings: c.meetings.map((m) => ({ ...m, first_name: first, last_name: last, phone: draft.phone.trim() || m.phone })) }
            : c
        )
      )
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

  const toggleSelectAll = (client: AdminClientCard) => {
    const upcoming = client.meetings.filter(isUpcomingConfirmed)
    const cur = selected[client.contact_id]
    const allSelected = cur && upcoming.length > 0 && upcoming.every((m) => cur.has(m.booking_id!))
    setSelected((prev) => {
      const next = { ...prev }
      if (allSelected) next[client.contact_id] = new Set<string>()
      else next[client.contact_id] = new Set(upcoming.map((m) => m.booking_id!).filter(Boolean))
      return next
    })
  }

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
      const when = first?.slot_start ? formatNiceDateTime(first.slot_start, first.time_zone) : `${res.meetingsCount} meetings`
      toast.success(`Email sent to ${first ? `${client.first_name} ${client.last_name}` : res.sentTo} - ${when}`)
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
      const when = row?.slot_start ? formatNiceDateTime(row.slot_start, row.time_zone) : `${res.meetingsCount} meetings`
      toast.success(`Email sent to ${client.first_name} ${client.last_name} - ${when}`)
    } catch (err: any) {
      toast.error(mapError(err))
    } finally {
      setSendingEmail((prev) => ({ ...prev, [client.contact_id]: false, [`${client.contact_id}:${bookingId}`]: false } as any))
    }
  }

  const handleCancelBooking = async () => {
    if (!deleteTarget?.meeting.booking_id) return
    if (deleteTarget.mode !== 'cancel') return
    const target = deleteTarget
    const snapshot = clients
    setDeleteLoading(true)
    setClients((prev) =>
      prev.map((c) =>
        c.contact_id === target.client.contact_id
          ? {
              ...c,
              meetings: c.meetings.map((m) => (m.booking_id === target.meeting.booking_id ? { ...m, status: 'cancelled', cancelled_at: new Date().toISOString() } : m)),
            }
          : c
      )
    )
    setDeleteTarget(null)
    try {
      const res = await cancelAdminBooking(target.meeting.booking_id!, notifyClientChecked)
      toast.success(`Meeting for ${target.client.first_name} ${target.client.last_name} cancelled${res.notified ? ' and client notified' : ''}`)
      setSelected((prev) => {
        const next = { ...prev }
        if (next[target.client.contact_id]) {
          const s = new Set(next[target.client.contact_id])
          s.delete(target.meeting.booking_id!)
          next[target.client.contact_id] = s
        }
        return next
      })
      const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
      setClients(data)
      setLastSearchParams({ q, startDate, endDate, showHidden })
    } catch (err: any) {
      setClients(snapshot)
      toast.error(mapError(err))
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleHideBooking = async () => {
    if (!deleteTarget?.meeting.booking_id) return
    if (deleteTarget.mode !== 'hide') return
    const target = deleteTarget
    const snapshot = clients
    setDeleteLoading(true)
    setClients((prev) =>
      prev.map((c) => {
        if (c.contact_id !== target.client.contact_id) return c
        if (showHidden) {
          return { ...c, meetings: c.meetings.map((m) => (m.booking_id === target.meeting.booking_id ? { ...m, deleted_at: new Date().toISOString() } : m)) }
        }
        return { ...c, meetings: c.meetings.filter((m) => m.booking_id !== target.meeting.booking_id) }
      })
    )
    setDeleteTarget(null)
    try {
      await hideAdminBooking(target.meeting.booking_id!)
      setSelected((prev) => {
        const next = { ...prev }
        if (next[target.client.contact_id]) {
          const s = new Set(next[target.client.contact_id])
          s.delete(target.meeting.booking_id!)
          next[target.client.contact_id] = s
        }
        return next
      })
      toast((t) => (
        <span className="flex items-center gap-2">
          Meeting hidden - you can restore it from Show hidden
          <button
            className="ml-2 underline font-semibold"
            onClick={async () => {
              toast.dismiss(t.id)
              try {
                await unhideAdminBooking(target.meeting.booking_id!)
                toast.success('Meeting restored')
              } catch {
                setClients(snapshot)
                toast.error('Restore failed — list refreshed')
              }
              const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
              setClients(data)
              setLastSearchParams({ q, startDate, endDate, showHidden })
            }}
          >
            Undo
          </button>
        </span>
      ), { duration: 6000 })
      if (showHidden) {
        const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
        setClients(data)
        setLastSearchParams({ q, startDate, endDate, showHidden })
      }
    } catch (err: any) {
      setClients(snapshot)
      toast.error(mapError(err))
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleHideSelected = (client: AdminClientCard, triggerEl?: HTMLElement) => {
    const sel = selected[client.contact_id]
    if (!sel || sel.size === 0) {
      toast.error('Select meetings to hide')
      return
    }
    const hideable = client.meetings.filter((m) => {
      const status = getRowStatus(m)
      return (status === 'cancelled' || status === 'completed') && m.booking_id && sel.has(m.booking_id)
    })
    if (hideable.length === 0) {
      toast.error('No hideable meetings selected - upcoming must be cancelled first')
      return
    }
    if (triggerEl) {
      lastTriggerRef.current = triggerEl
      lastTriggerRef.current.dataset.trigger = `bulk-hide-${client.contact_id}`
    }
    setBulkHideTarget({ client, meetings: hideable })
  }

  const handleConfirmBulkHide = async () => {
    if (!bulkHideTarget) return
    const { client, meetings: hideable } = bulkHideTarget
    const snapshot = clients
    setBulkHideTarget(null)
    setDeleteLoading(true)
    const hideIds = new Set(hideable.map((h) => h.booking_id!))
    setClients((prev) =>
      prev.map((c) => {
        if (c.contact_id !== client.contact_id) return c
        if (showHidden) {
          return { ...c, meetings: c.meetings.map((m) => (m.booking_id && hideIds.has(m.booking_id) ? { ...m, deleted_at: new Date().toISOString() } : m)) }
        }
        return { ...c, meetings: c.meetings.filter((m) => !(m.booking_id && hideIds.has(m.booking_id))) }
      })
    )
    setSelected((prev) => {
      const next = { ...prev }
      if (next[client.contact_id]) {
        const s = new Set(next[client.contact_id])
        for (const h of hideable) s.delete(h.booking_id!)
        next[client.contact_id] = s
      }
      return next
    })
    try {
      const results = await Promise.allSettled(hideable.map((h) => hideAdminBooking(h.booking_id!)))
      const failed = results.filter((r) => r.status === 'rejected')
      if (failed.length > 0) {
        // Avoid stale snapshot rollback — refetch authoritative state
        toast.error(`${failed.length} of ${hideable.length} hides failed — refreshing list`)
        const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
        setClients(data)
        setLastSearchParams({ q, startDate, endDate, showHidden })
      } else {
        // Success with undo similar to single hide
        toast((t) => (
          <span className="flex items-center gap-2">
            {hideable.length} meeting(s) hidden
            <button
              className="ml-2 underline font-semibold"
              onClick={async () => {
                toast.dismiss(t.id)
                try {
                  await Promise.allSettled(hideable.map((h) => unhideAdminBooking(h.booking_id!)))
                  toast.success(`${hideable.length} meeting(s) restored`)
                } catch {
                  toast.error('Restore failed — list refreshed')
                }
                const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
                setClients(data)
                setLastSearchParams({ q, startDate, endDate, showHidden })
              }}
            >
              Undo
            </button>
          </span>
        ), { duration: 6000 })
        if (showHidden) {
          const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
          setClients(data)
          setLastSearchParams({ q, startDate, endDate, showHidden })
        }
      }
    } catch (err: any) {
      // Network or search failure — do not roll back to stale snapshot mid-failure, refetch if possible
      try {
        const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
        setClients(data)
        setLastSearchParams({ q, startDate, endDate, showHidden })
      } catch {
        setClients(snapshot)
      }
      toast.error(mapError(err))
    } finally {
      setDeleteLoading(false)
    }
  }

  const handleUnhide = async (client: AdminClientCard, bookingId: string) => {
    try {
      await unhideAdminBooking(bookingId)
      toast.success('Meeting restored')
      const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
      setClients(data)
      setLastSearchParams({ q, startDate, endDate, showHidden })
    } catch (err: any) {
      toast.error(mapError(err))
    }
  }

  const handleOpenRebook = (client: AdminClientCard, meeting: AdminClientRow, triggerEl?: HTMLElement) => {
    if (!meeting.booking_id) return
    if (triggerEl) {
      lastTriggerRef.current = triggerEl
      lastTriggerRef.current.dataset.trigger = `rebook-${meeting.booking_id}`
    }
    const startIso = meeting.slot_start
    const endIso = meeting.slot_end
    const isFuture = startIso ? new Date(startIso).getTime() >= Date.now() - 60_000 : false
    setRebookForm({
      slot_start: isFuture ? isoToDatetimeLocal(startIso) : '',
      slot_end: isFuture ? isoToDatetimeLocal(endIso) : '',
      time_zone: meeting.time_zone || '',
    })
    setRebookErrors({})
    setRebookTarget({ client, meeting })
  }

  const handleConfirmRebook = async () => {
    if (!rebookTarget?.meeting.booking_id) return
    const errs: Record<string, string> = {}
    if (!rebookForm.slot_start) errs.slot_start = 'Start time required — original was in past'
    if (!rebookForm.slot_end) errs.slot_end = 'End time required'
    if (rebookForm.slot_start && rebookForm.slot_end) {
      const s = new Date(rebookForm.slot_start).getTime()
      const e = new Date(rebookForm.slot_end).getTime()
      if (!isNaN(s) && !isNaN(e) && s >= e) errs.slot_end = 'End must be after start'
      if (!isNaN(s) && s < Date.now() - 60_000) errs.slot_start = 'Pick a future time'
    }
    setRebookErrors(errs)
    if (Object.keys(errs).length > 0) {
      toast.error('Fix the highlighted fields')
      return
    }
    const client = rebookTarget.client
    const meeting = rebookTarget.meeting
    const target = rebookTarget
    setRebookTarget(null)
    setDeleteLoading(true)
    try {
      const res = await rebookAdminBooking(meeting.booking_id!, {
        slot_start: new Date(rebookForm.slot_start).toISOString(),
        slot_end: new Date(rebookForm.slot_end).toISOString(),
        time_zone: rebookForm.time_zone || undefined,
      }) as any
      const hasRealInvite = res?.meetLink && String(res.meetLink).startsWith('https://') && !String(res.meetLink).includes('fake-')
      const msg = hasRealInvite
        ? `Rebooked for ${client.first_name} ${client.last_name} — new invite created, original cancel link still works`
        : res?.source === 'stub'
          ? `Rebooked (stub) for ${client.first_name} ${client.last_name} — local dev, no real calendar invite`
          : `Rebooked for ${client.first_name} ${client.last_name}`
      toast.success(msg)
      const data = await searchAdminClientsGrouped(q, { startDate, endDate, showHidden })
      setClients(data)
      setLastSearchParams({ q, startDate, endDate, showHidden })
    } catch (err: any) {
      // If backend says past, keep dialog open with error rather than dead end toast
      const raw = (err?.body?.error || err?.message || '').toString().toLowerCase()
      if (raw.includes('past') || raw.includes('pick a future')) {
        setRebookTarget(target)
        setRebookErrors({ slot_start: mapError(err) })
        toast.error(mapError(err))
      } else {
        toast.error(mapError(err))
      }
    } finally {
      setDeleteLoading(false)
    }
  }

  const getSortedMeetings = (meetings: AdminClientRow[]) => {
    const upcoming = meetings.filter((m) => getRowStatus(m) === 'upcoming').sort((a, b) => new Date(a.slot_start!).getTime() - new Date(b.slot_start!).getTime())
    const cancelled = meetings.filter((m) => getRowStatus(m) === 'cancelled').sort((a, b) => new Date(b.slot_start || 0).getTime() - new Date(a.slot_start || 0).getTime())
    const completed = meetings.filter((m) => getRowStatus(m) === 'completed').sort((a, b) => new Date(b.slot_start || 0).getTime() - new Date(a.slot_start || 0).getTime())
    const hidden = meetings.filter((m) => getRowStatus(m) === 'hidden').sort((a, b) => new Date(b.slot_start || 0).getTime() - new Date(a.slot_start || 0).getTime())
    return [...upcoming, ...cancelled, ...completed, ...hidden]
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

  function renderRowActions(client: AdminClientCard, r: AdminClientRow) {
    const status = getRowStatus(r)
    const canSelect = isUpcomingConfirmed(r)

    return (
      <div className="flex items-center gap-1">
        {canSelect && r.booking_id && (
          <button
            type="button"
            onClick={() => handleSendSingle(client, r.booking_id!)}
            aria-label={`Send meeting at ${r.slot_start} to ${client.email}`}
            title="Send this meeting"
            className="w-11 h-11 inline-flex items-center justify-center bg-white border border-slate-300 rounded-full hover:bg-slate-50 disabled:opacity-40"
            disabled={!!sendingEmail[client.contact_id]}
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path d="M2.003 5.884L10 9.882l7.997-3.998A2 2 0 0016 4H4a2 2 0 00-1.997 1.884z"/><path d="M18 8.118l-8 4-8-4V14a2 2 0 002 2h12a2 2 0 002-2V8.118z"/></svg>
          </button>
        )}

        {status === 'upcoming' && r.booking_id && (
          <button
            type="button"
            onClick={(e) => {
              lastTriggerRef.current = e.currentTarget as HTMLElement
              lastTriggerRef.current.dataset.trigger = `delete-${r.booking_id}`
              setDeleteTarget({ client, meeting: r, mode: 'cancel' })
              setNotifyClientChecked(true)
            }}
            aria-label={`Cancel meeting for ${client.email} at ${r.slot_start}`}
            title="Cancel meeting"
            className="w-11 h-11 inline-flex items-center justify-center bg-red-600 text-white rounded-full hover:bg-red-700"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 18a8 8 0 100-16 8 8 0 000 16zM8.707 7.293a1 1 0 00-1.414 1.414L8.586 10l-1.293 1.293a1 1 0 101.414 1.414L10 11.414l1.293 1.293a1 1 0 001.414-1.414L11.414 10l1.293-1.293a1 1 0 00-1.414-1.414L10 8.586 8.707 7.293z" clipRule="evenodd"/></svg>
          </button>
        )}

        {(status === 'completed' || status === 'cancelled') && r.booking_id && (
          <button
            type="button"
            onClick={(e) => {
              lastTriggerRef.current = e.currentTarget as HTMLElement
              lastTriggerRef.current.dataset.trigger = `delete-${r.booking_id}`
              setDeleteTarget({ client, meeting: r, mode: 'hide' })
            }}
            aria-label={`Hide meeting for ${client.email} at ${r.slot_start}`}
            title="Hide from list"
            className="w-11 h-11 inline-flex items-center justify-center bg-slate-100 border rounded-full hover:bg-slate-200"
          >
            {/* Fixed P1: was 24-viewport outline path (coords up to 21) in viewBox 20 with fill — clipped solid. Now proper 20-solid eye-slash */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true">
              <path d="M10 12a2 2 0 100-4 2 2 0 000 4z" />
              <path fillRule="evenodd" d="M.458 10C1.732 5.943 5.522 3 10 3s8.268 2.943 9.542 7c-1.274 4.057-5.064 7-9.542 7S1.732 14.057.458 10zM14 10a4 4 0 11-8 0 4 4 0 018 0z" clipRule="evenodd" />
              <path fillRule="evenodd" d="M3.28 2.22a.75.75 0 00-1.06 1.06l14.5 14.5a.75.75 0 101.06-1.06L3.28 2.22z" clipRule="evenodd" />
            </svg>
          </button>
        )}

        {status === 'hidden' && r.booking_id && (
          <button
            type="button"
            onClick={() => handleUnhide(client, r.booking_id!)}
            aria-label={`Restore meeting for ${client.email} at ${r.slot_start}`}
            title="Restore"
            className="w-11 h-11 inline-flex items-center justify-center bg-amber-100 border border-amber-200 rounded-full hover:bg-amber-50"
          >
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M4 2a1 1 0 011 1v2.101a7.002 7.002 0 0111.601 2.566 1 1 0 11-1.885.666A5.002 5.002 0 005.999 7H9a1 1 0 010 2H4a1 1 0 01-1-1V3a1 1 0 011-1zm.008 9.057a1 1 0 011.276.61A5.002 5.002 0 0014.001 13H11a1 1 0 110-2h5a1 1 0 011 1v5a1 1 0 11-2 0v-2.101a7.002 7.002 0 01-11.601-2.566 1 1 0 01.61-1.276z" clipRule="evenodd"/></svg>
          </button>
        )}

        {status === 'cancelled' && r.booking_id && (
          <button
            type="button"
            onClick={(e) => handleOpenRebook(client, r, e.currentTarget as HTMLElement)}
            aria-label={`Rebook meeting for ${client.email} at ${r.slot_start}`}
            title="Rebook — pick a new time"
            className="w-11 h-11 inline-flex items-center justify-center bg-blue-600 text-white rounded-full hover:bg-blue-700"
          >
            {/* Distinct from Restore (circular arrow) — plus icon for new booking */}
            <svg xmlns="http://www.w3.org/2000/svg" className="w-5 h-5" viewBox="0 0 20 20" fill="currentColor" aria-hidden="true"><path fillRule="evenodd" d="M10 3a1 1 0 011 1v5h5a1 1 0 110 2h-5v5a1 1 0 11-2 0v-5H4a1 1 0 110-2h5V4a1 1 0 011-1z" clipRule="evenodd"/></svg>
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="p-4 max-w-6xl mx-auto">
      <div className="sticky top-0 bg-white p-4 border-b flex flex-wrap justify-between items-center gap-3 z-10 mb-2 rounded-t-xl">
        <h1 className="text-xl font-bold">Admin Client Portal</h1>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            data-trigger="add"
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
          <div ref={addModalRef} role="dialog" aria-modal="true" aria-labelledby="add-booking-title" className="bg-white p-6 rounded-2xl shadow w-full max-w-md max-h-[90vh] overflow-auto">
            <h2 id="add-booking-title" className="text-lg font-bold mb-4">Add Booking</h2>
            <form onSubmit={handleCreateBooking} noValidate>
              <div className="grid grid-cols-2 gap-3 mb-2">
                <div className="flex flex-col gap-1">
                  <label htmlFor="add-first_name" className="text-xs font-medium">First name *</label>
                  <input id="add-first_name" ref={addFirstFieldRef} placeholder="First name" className={`border p-2 rounded ${newBookingErrors.first_name ? 'border-red-500' : ''}`} value={newBooking.first_name} onChange={(e) => setNewBooking({ ...newBooking, first_name: e.target.value })} required aria-invalid={!!newBookingErrors.first_name} aria-describedby={newBookingErrors.first_name ? 'add-first_name-error' : undefined} />
                  {newBookingErrors.first_name && <p id="add-first_name-error" className="text-xs text-red-600">{newBookingErrors.first_name}</p>}
                </div>
                <div className="flex flex-col gap-1">
                  <label htmlFor="add-last_name" className="text-xs font-medium">Last name *</label>
                  <input id="add-last_name" placeholder="Last name" className={`border p-2 rounded ${newBookingErrors.last_name ? 'border-red-500' : ''}`} value={newBooking.last_name} onChange={(e) => setNewBooking({ ...newBooking, last_name: e.target.value })} required aria-invalid={!!newBookingErrors.last_name} aria-describedby={newBookingErrors.last_name ? 'add-last_name-error' : undefined} />
                  {newBookingErrors.last_name && <p id="add-last_name-error" className="text-xs text-red-600">{newBookingErrors.last_name}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-email" className="text-xs font-medium">Email *</label>
                  <input id="add-email" type="email" placeholder="client@example.com" className={`border p-2 rounded ${newBookingErrors.email ? 'border-red-500' : ''}`} value={newBooking.email} onChange={(e) => setNewBooking({ ...newBooking, email: e.target.value })} required aria-invalid={!!newBookingErrors.email} aria-describedby={newBookingErrors.email ? 'add-email-error' : undefined} />
                  {newBookingErrors.email && <p id="add-email-error" className="text-xs text-red-600">{newBookingErrors.email}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-phone" className="text-xs font-medium">Phone</label>
                  <input id="add-phone" placeholder="Phone" className="border p-2 rounded col-span-2" value={newBooking.phone} onChange={(e) => setNewBooking({ ...newBooking, phone: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-purpose" className="text-xs font-medium">Purpose</label>
                  <input id="add-purpose" placeholder="Tax filing, consultation..." className="border p-2 rounded col-span-2" value={newBooking.purpose} onChange={(e) => setNewBooking({ ...newBooking, purpose: e.target.value })} />
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-slot_start" className="text-xs font-medium">Start *</label>
                  <input id="add-slot_start" type="datetime-local" className={`border p-2 rounded ${newBookingErrors.slot_start ? 'border-red-500' : ''}`} value={newBooking.slot_start} onChange={(e) => setNewBooking({ ...newBooking, slot_start: e.target.value })} required aria-invalid={!!newBookingErrors.slot_start} />
                  {newBookingErrors.slot_start && <p className="text-xs text-red-600">{newBookingErrors.slot_start}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="add-slot_end" className="text-xs font-medium">End *</label>
                  <input id="add-slot_end" type="datetime-local" className={`border p-2 rounded ${newBookingErrors.slot_end ? 'border-red-500' : ''}`} value={newBooking.slot_end} onChange={(e) => setNewBooking({ ...newBooking, slot_end: e.target.value })} required aria-invalid={!!newBookingErrors.slot_end} />
                  {newBookingErrors.slot_end && <p className="text-xs text-red-600">{newBookingErrors.slot_end}</p>}
                </div>
                <div className="flex flex-col gap-1 col-span-2">
                  <label htmlFor="tz-select" className="text-xs font-medium">Timezone</label>
                  <select id="tz-select" className="border p-2 rounded col-span-2 text-sm" value={newBooking.time_zone} onChange={(e) => setNewBooking({ ...newBooking, time_zone: e.target.value })} aria-label="Timezone">
                    {US_TIMEZONES.map((tz) => (
                      <option key={tz.value} value={tz.value}>{tz.label}</option>
                    ))}
                  </select>
                </div>
                <label className="col-span-2 flex items-center gap-2 text-sm mt-2">
                  <input type="checkbox" checked={newBooking.sendEmail} onChange={(e) => setNewBooking({ ...newBooking, sendEmail: e.target.checked })} />
                  Send Confirmation Email
                </label>
              </div>
              <p className="text-xs text-slate-500 mb-4">The Google Drive folder and Meet link are created automatically.</p>
              <div className="flex justify-end gap-2">
                <button type="button" onClick={() => setShowAddModal(false)} className="px-4 py-2 rounded-full border text-sm min-h-11">Discard</button>
                <button type="submit" disabled={createLoading} className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">{createLoading ? 'Creating...' : 'Create'}</button>
              </div>
            </form>
          </div>
        </div>
      )}

      {deleteTarget && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={(e) => handleOverlayClick(e, () => setDeleteTarget(null))} onKeyDown={(e: any) => { if (e.key === 'Escape') setDeleteTarget(null); trapFocus(e, deleteModalRef) }}>
          <div ref={deleteModalRef} role="dialog" aria-modal="true" aria-labelledby="delete-booking-title" className="bg-white p-6 rounded-2xl shadow w-full max-w-md">
            {deleteTarget.mode === 'cancel' ? (
              <>
                <h2 id="delete-booking-title" className="text-lg font-bold mb-2">Cancel meeting</h2>
                <p className="mb-3 text-sm text-slate-600">This will remove the Google Calendar event and keep the row as Cancelled. The calendar event cannot be restored - rebooking creates a new invite. The clients existing cancel link keeps working.</p>
                <p className="mb-4 text-sm">Cancel meeting for {deleteTarget.client.first_name} {deleteTarget.client.last_name} at {deleteTarget.meeting.slot_start ? formatNiceDateTime(deleteTarget.meeting.slot_start, deleteTarget.meeting.time_zone) : 'N/A'}?</p>
                <label className="flex items-center gap-2 mb-4 text-sm">
                  <input type="checkbox" checked={notifyClientChecked} onChange={(e) => setNotifyClientChecked(e.target.checked)} />
                  Notify client by email?
                </label>
                {!notifyClientChecked && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-4">Silent cancel: if unchecked, the Google event is removed with no email from Google and no Resend email — calendar entry vanishes silently. Intended for test bookings only; default is checked.</p>}
                <div className="flex justify-end gap-2">
                  <button ref={deleteCancelRef} type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-full border text-sm min-h-11">Keep booking</button>
                  <button type="button" onClick={handleCancelBooking} disabled={deleteLoading} className="bg-red-600 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">{deleteLoading ? 'Cancelling...' : 'Cancel meeting'}</button>
                </div>
              </>
            ) : (
              <>
                <h2 id="delete-booking-title" className="text-lg font-bold mb-2">Hide meeting</h2>
                <p className="mb-3 text-sm text-slate-600">This hides the row from the list. No calendar event is deleted and no email is sent. You can restore it via Show hidden toggle.</p>
                <p className="mb-4 text-sm">Hide meeting for {deleteTarget.client.first_name} {deleteTarget.client.last_name} at {deleteTarget.meeting.slot_start ? formatNiceDateTime(deleteTarget.meeting.slot_start, deleteTarget.meeting.time_zone) : 'N/A'}?</p>
                <div className="flex justify-end gap-2">
                  <button ref={deleteCancelRef} type="button" onClick={() => setDeleteTarget(null)} className="px-4 py-2 rounded-full border text-sm min-h-11">Keep visible</button>
                  <button type="button" onClick={handleHideBooking} disabled={deleteLoading} className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">{deleteLoading ? 'Hiding...' : 'Hide'}</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {bulkHideTarget && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={(e) => handleOverlayClick(e, () => setBulkHideTarget(null))} onKeyDown={(e: any) => { if (e.key === 'Escape') setBulkHideTarget(null); trapFocus(e, bulkHideModalRef) }}>
          <div ref={bulkHideModalRef} role="dialog" aria-modal="true" aria-labelledby="bulk-hide-title" className="bg-white p-6 rounded-2xl shadow w-full max-w-md">
            <h2 id="bulk-hide-title" className="text-lg font-bold mb-2">Hide {bulkHideTarget.meetings.length} meeting{bulkHideTarget.meetings.length !== 1 ? 's' : ''}</h2>
            <p className="mb-3 text-sm text-slate-600">This hides {bulkHideTarget.meetings.length} row{bulkHideTarget.meetings.length !== 1 ? 's' : ''} from the list for {bulkHideTarget.client.first_name} {bulkHideTarget.client.last_name}. No calendar events are deleted and no emails are sent. You can restore via Show hidden toggle.</p>
            <ul className="mb-4 text-xs text-slate-600 max-h-32 overflow-auto list-disc pl-4">
              {bulkHideTarget.meetings.slice(0, 10).map((m) => (
                <li key={m.booking_id}>{m.slot_start ? formatNiceDateTime(m.slot_start, m.time_zone) : m.booking_id} · {getRowStatus(m)}</li>
              ))}
              {bulkHideTarget.meetings.length > 10 && <li>...and {bulkHideTarget.meetings.length - 10} more</li>}
            </ul>
            <div className="flex justify-end gap-2">
              <button ref={bulkHideCancelRef} type="button" onClick={() => setBulkHideTarget(null)} className="px-4 py-2 rounded-full border text-sm min-h-11">Keep visible</button>
              <button type="button" onClick={handleConfirmBulkHide} disabled={deleteLoading} className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">{deleteLoading ? 'Hiding...' : `Hide ${bulkHideTarget.meetings.length}`}</button>
            </div>
          </div>
        </div>
      )}

      {rebookTarget && (
        <div className="fixed inset-0 bg-black/50 flex justify-center items-center z-50 p-4" onClick={(e) => handleOverlayClick(e, () => setRebookTarget(null))} onKeyDown={(e: any) => { if (e.key === 'Escape') setRebookTarget(null); trapFocus(e, rebookModalRef) }}>
          <div ref={rebookModalRef} role="dialog" aria-modal="true" aria-labelledby="rebook-title" className="bg-white p-6 rounded-2xl shadow w-full max-w-md max-h-[90vh] overflow-auto">
            <h2 id="rebook-title" className="text-lg font-bold mb-2">Rebook meeting</h2>
            <p className="mb-3 text-sm text-slate-600">Rebook for {rebookTarget.client.first_name} {rebookTarget.client.last_name} ({rebookTarget.client.email}). Original: {rebookTarget.meeting.slot_start ? formatNiceDateTime(rebookTarget.meeting.slot_start, rebookTarget.meeting.time_zone) : 'N/A'} · {rebookTarget.meeting.purpose || 'No purpose'}. Pick a new future time — this creates a new Google Calendar invite reusing the existing row and keeps the old cancel link working.</p>
            <div className="flex flex-col gap-3 mb-4">
              <div className="flex flex-col gap-1">
                <label htmlFor="rebook-start" className="text-xs font-medium">New start *</label>
                <input id="rebook-start" type="datetime-local" className={`border p-2 rounded text-sm ${rebookErrors.slot_start ? 'border-red-400' : ''}`} value={rebookForm.slot_start} onChange={(e) => setRebookForm({ ...rebookForm, slot_start: e.target.value })} />
                {rebookErrors.slot_start && <p className="text-xs text-red-600">{rebookErrors.slot_start}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="rebook-end" className="text-xs font-medium">New end *</label>
                <input id="rebook-end" type="datetime-local" className={`border p-2 rounded text-sm ${rebookErrors.slot_end ? 'border-red-400' : ''}`} value={rebookForm.slot_end} onChange={(e) => setRebookForm({ ...rebookForm, slot_end: e.target.value })} />
                {rebookErrors.slot_end && <p className="text-xs text-red-600">{rebookErrors.slot_end}</p>}
              </div>
              <div className="flex flex-col gap-1">
                <label htmlFor="rebook-tz" className="text-xs font-medium">Timezone</label>
                <select id="rebook-tz" className="border p-2 rounded text-sm" value={rebookForm.time_zone} onChange={(e) => setRebookForm({ ...rebookForm, time_zone: e.target.value })}>
                  {US_TIMEZONES.map((tz) => (
                    <option key={tz.value || 'default'} value={tz.value}>{tz.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="flex justify-end gap-2">
              <button ref={rebookCancelRef} type="button" onClick={() => setRebookTarget(null)} className="px-4 py-2 rounded-full border text-sm min-h-11">Discard</button>
              <button type="button" onClick={handleConfirmRebook} disabled={deleteLoading} className="bg-blue-600 text-white px-4 py-2 rounded-full text-sm min-h-11 disabled:opacity-50">{deleteLoading ? 'Rebooking...' : 'Rebook'}</button>
            </div>
          </div>
        </div>
      )}

      <form onSubmit={(e) => handleSearch(e, { forceClearSelection: true })} className="my-4 p-4 border rounded-xl flex flex-wrap gap-3 items-end bg-slate-50">
        <div className="flex-1 min-w-[200px]">
          <label htmlFor="q" className="block text-sm font-medium mb-1">Search</label>
          <input id="q" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Email, first name, last name, or Drive link" className="border p-2 rounded w-full" />
        </div>
        <div>
          <label htmlFor="startDate" className="block text-sm font-medium mb-1">From</label>
          <input id="startDate" type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} className="border p-2 rounded" />
        </div>
        <div>
          <label htmlFor="endDate" className="block text-sm font-medium mb-1">To</label>
          <input id="endDate" type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} className="border p-2 rounded" />
        </div>
        <label className="flex items-center gap-2 text-sm">
          <input type="checkbox" checked={showHidden} onChange={(e) => setShowHidden(e.target.checked)} />
          Show hidden
        </label>
        <button type="submit" disabled={searchLoading} className="bg-slate-900 text-white px-5 py-2 rounded-full text-sm font-semibold min-h-11 disabled:opacity-50">{searchLoading ? 'Searching...' : 'Search'}</button>
      </form>

      {!hasSearched && !clients.length ? (
        <div className="border rounded-xl p-8 text-center bg-white">
          <p className="text-sm text-slate-600">Enter a search to find clients - by email, name, or paste a Drive folder link.</p>
        </div>
      ) : hasSearched && !clients.length ? (
        <p className="text-sm text-slate-500 border rounded-xl p-6 text-center">No clients matched. Check spelling or try a broader search - or the client may not exist yet. Add a booking to create them.</p>
      ) : (
        <>
          {hasSearched && <p className="text-sm text-slate-700 mb-2">{clients.length} client{clients.length !== 1 ? 's' : ''} found, {totalMeetings} meeting{totalMeetings !== 1 ? 's' : ''} total</p>}
          {clients.length >= 50 && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">Showing first 50 contacts - refine search for more.</p>}
          {clients.some((c) => c.meetings.length >= 500) && <p className="text-xs text-amber-700 bg-amber-50 border border-amber-200 rounded p-2 mb-2">Some clients have 500+ meetings - only first 500 shown.</p>}
          <p className="text-xs text-slate-500 mb-2">Only upcoming meetings can be forwarded. Past and cancelled need Cancel then Hide. Hidden rows are reversible via Show hidden.</p>
          <div className="space-y-6">
            {clients.map((client) => {
              const selSet = selected[client.contact_id] || new Set<string>()
              const selCount = selSet.size
              const upcomingCount = client.meetings.filter(isUpcomingConfirmed).length
              const hideableCount = client.meetings.filter((m) => { const s = getRowStatus(m); return (s === 'cancelled' || s === 'completed') && m.booking_id && selSet.has(m.booking_id) }).length
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
                          <button type="button" onClick={() => handleSaveClientEdit(client.contact_id)} disabled={!!savingClient[client.contact_id]} className="bg-blue-600 text-white px-3 py-1.5 rounded-full text-xs font-semibold min-h-8 disabled:opacity-50">{savingClient[client.contact_id] ? 'Saving...' : 'Save'}</button>
                          <button type="button" onClick={() => { setClientEditMode((prev) => ({ ...prev, [client.contact_id]: false })); setEditingClient((prev) => { const n = { ...prev }; delete n[client.contact_id]; return n }) }} className="border px-3 py-1.5 rounded-full text-xs min-h-8">Discard</button>
                          <div className="w-full text-[11px] text-slate-500">Email is the Drive folder name and cannot be edited here - {client.email}</div>
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
                                <a key={`${y.year}-${y.folder_id}`} href={y.folder_url} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline mr-2">{y.year} ↗</a>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                    <div className="flex flex-col items-end gap-2">
                      <div className="flex gap-2">
                        <button type="button" data-testid={`send-${client.contact_id}`} onClick={() => handleSend(client)} disabled={selCount === 0 || isSending} aria-label={`Send ${selCount} selected meetings to ${client.email}`} className="bg-green-600 text-white px-4 py-2 rounded-full text-sm font-semibold min-h-11 disabled:opacity-40 disabled:cursor-not-allowed">{isSending ? 'Sending...' : `Send selected (${selCount})`}</button>
                        <button type="button" data-testid={`hide-${client.contact_id}`} onClick={(e) => handleHideSelected(client, e.currentTarget as HTMLElement)} disabled={hideableCount === 0} aria-label={`Hide ${hideableCount} selected meetings for ${client.email}`} title={hideableCount === 0 ? 'Select cancelled or completed meetings to hide - upcoming must be cancelled first' : `Hide ${hideableCount} selected`} className="bg-slate-900 text-white px-4 py-2 rounded-full text-sm font-semibold min-h-11 disabled:opacity-40 disabled:cursor-not-allowed">{`Hide selected (${hideableCount})`}</button>
                      </div>
                      {selCount === 0 && upcomingCount > 0 && <span className="text-[11px] text-slate-500">Tick upcoming meetings to forward; cancelled/completed can be hidden after selection</span>}
                      {upcomingCount === 0 && selCount === 0 && <span className="text-[11px] text-slate-500">No upcoming meetings to send - past/cancelled can be hidden</span>}
                      {selCount > 0 && <span className="text-[11px] text-slate-500">{selCount} selected - {client.meetings.filter((m) => m.booking_id && selSet.has(m.booking_id) && getRowStatus(m) === 'upcoming').length} upcoming, {client.meetings.filter((m) => m.booking_id && selSet.has(m.booking_id) && (getRowStatus(m) === 'completed' || getRowStatus(m) === 'cancelled')).length} hideable</span>}
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
                          <span className="text-xs font-medium text-slate-600">Google Drive:</span>
                          {hasValidLink ? <a href={currentDrive} target="_blank" rel="noopener noreferrer" className="text-sm text-blue-600 underline truncate max-w-[360px]" title={currentDrive}>{currentDrive}</a> : currentDrive ? <span className="text-sm text-slate-500 truncate max-w-[360px]" title={currentDrive}>{currentDrive} (invalid)</span> : <span className="text-sm text-slate-500">No Drive link</span>}
                          <div className="flex gap-1 items-center ml-2">
                            {hasValidLink && <button type="button" onClick={() => copyToClipboard(currentDrive)} aria-label={`Copy Drive link for ${client.email}`} className="text-slate-600 border px-2 py-1.5 rounded text-xs min-h-8" title="Copy Drive link">Copy</button>}
                            <button type="button" onClick={handleEnterEdit} aria-label={hasValidLink ? `Edit Drive link for ${client.email}` : `Add Drive link for ${client.email}`} className="text-white bg-blue-600 px-3 py-1.5 rounded-full text-xs font-semibold min-h-8">{hasValidLink ? 'Edit' : '+ Add Drive link'}</button>
                          </div>
                          {client.drive_is_manual ? <span className="text-[10px] bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5">✎ manual</span> : null}
                        </div>
                      )
                    }
                    return (
                      <div className="p-3 flex flex-wrap gap-2 items-start border-b bg-white">
                        <label htmlFor={`drive-${client.contact_id}`} className="text-xs font-medium text-slate-600 mt-2">Google Drive:</label>
                        <div className="flex-1 min-w-[280px]">
                          <div className="flex gap-1">
                            <input id={`drive-${client.contact_id}`} value={displayUrl || ''} onChange={(e) => setEditingDrive({ ...editingDrive, [client.contact_id]: e.target.value })} onBlur={(e) => validateDriveLink(client.contact_id, e.target.value)} placeholder="https://drive.google.com/drive/folders/..." className={`border p-2 rounded text-sm w-full ${driveErrors[client.contact_id] ? 'border-red-400' : ''} ${isUnsaved ? 'bg-amber-50' : ''}`} aria-label={`Drive folder URL for ${client.email}`} aria-describedby={driveErrors[client.contact_id] ? `drive-err-${client.contact_id}` : undefined} />
                            {currentDrive && <button type="button" onClick={() => copyToClipboard(editingDrive[client.contact_id] ?? currentDrive)} aria-label={`Copy Drive link for ${client.email}`} className="text-slate-600 border px-2 py-2 rounded text-xs min-h-11" title="Copy Drive link">Copy</button>}
                          </div>
                          {driveErrors[client.contact_id] && <p id={`drive-err-${client.contact_id}`} className="text-xs text-red-600 mt-1">{driveErrors[client.contact_id]}</p>}
                          {isUnsaved && !driveErrors[client.contact_id] && <p className="text-[11px] text-amber-700 mt-1">Unsaved changes</p>}
                        </div>
                        <button type="button" onClick={() => handleSaveDriveLink(client.contact_id)} disabled={isSaving} aria-label={`Save Drive link for ${client.email}`} className="text-white bg-blue-600 px-4 py-2 rounded-full text-xs font-semibold min-h-11 disabled:opacity-50 mt-0.5">{isSaving ? 'Saving...' : 'Save'}</button>
                        <button type="button" onClick={handleCancelEdit} className="border px-4 py-2 rounded-full text-xs min-h-11 mt-0.5">Discard</button>
                        {client.drive_is_manual ? <span className="text-[10px] bg-amber-100 border border-amber-300 rounded-full px-2 py-0.5 mt-2">✎ manual</span> : null}
                      </div>
                    )
                  })()}

                  {client.meetings.length === 0 ? <p className="text-sm text-slate-500 p-4">No meetings in the selected range.</p> : (
                    <>
                      <div className="hidden sm:block overflow-x-auto">
                        <table className="w-full text-sm">
                          <caption className="sr-only">Meetings for {client.email}</caption>
                          <thead>
                            <tr className="border-b bg-slate-50/50 text-xs text-slate-500">
                              <th className="p-2 w-8" scope="col"><input type="checkbox" data-testid="select-all" aria-label={`Select all upcoming meetings for ${client.email}`} checked={(() => { const up = client.meetings.filter(isUpcomingConfirmed); return up.length > 0 && up.every((m) => selSet.has(m.booking_id!)) })()} onChange={() => toggleSelectAll(client)} /></th>
                              <th className="p-2 text-left" scope="col">Meeting Time</th>
                              <th className="p-2 text-left" scope="col">Purpose</th>
                              <th className="p-2 text-left" scope="col">Meeting URL</th>
                              <th className="p-2 text-left" scope="col">Status</th>
                              <th className="p-2 text-left" scope="col">Actions</th>
                            </tr>
                          </thead>
                          <tbody>
                            {sortedMeetings.map((r) => {
                              return (
                                <tr key={r.booking_id || `${r.contact_id}-no-id`} className="border-b">
                                  <td className="p-2">
                                    {r.booking_id ? <input type="checkbox" data-booking-id={r.booking_id} data-testid={`meeting-${r.booking_id}`} disabled={getRowStatus(r) === 'hidden'} aria-label={`${isUpcomingConfirmed(r) ? 'Select' : 'Select for hide'} ${r.slot_start ? formatNiceDateTime(r.slot_start, r.time_zone) : ''}`} checked={selSet.has(r.booking_id!)} onChange={() => toggleMeeting(client.contact_id, r.booking_id!)} /> : null}
                                  </td>
                                  <td className="p-2 whitespace-nowrap">{r.slot_start ? formatNiceDateTime(r.slot_start, r.time_zone) : '-'}</td>
                                  <td className="p-2">
                                    {(() => {
                                      const p = r.purpose || ''
                                      if (!p) return <span className="text-slate-400">-</span>
                                      const id = r.booking_id || `${r.contact_id}-${r.slot_start}`
                                      const expanded = !!expandedPurpose[id]
                                      const needsClamp = p.length > 100
                                      return <div className="max-w-[280px]"><span title={p}>{needsClamp && !expanded ? p.slice(0, 100) + '...' : p}</span>{needsClamp && <button type="button" onClick={() => setExpandedPurpose((prev) => ({ ...prev, [id]: !prev[id] }))} className="ml-1 text-xs text-blue-600 underline">{expanded ? 'Show less' : 'Show more'}</button>}</div>
                                    })()}
                                  </td>
                                  <td className="p-2 text-xs truncate max-w-[140px]">{r.meet_link ? <a href={r.meet_link} target="_blank" rel="noopener noreferrer" className="text-blue-600 underline">{r.meet_link.slice(0, 40)}...</a> : <span className="text-slate-500">Not recorded</span>}</td>
                                  <td className="p-2 text-xs">{getStatusChip(getRowStatus(r))}</td>
                                  <td className="p-2">{renderRowActions(client, r)}</td>
                                </tr>
                              )
                            })}
                          </tbody>
                        </table>
                      </div>
                      <div className="sm:hidden divide-y">
                        {sortedMeetings.map((r) => {
                          const status = getRowStatus(r)
                          return (
                            <div key={r.booking_id || `${r.contact_id}-no-id`} className="p-3 flex gap-3">
                              {r.booking_id ? <input type="checkbox" data-booking-id={r.booking_id} data-testid={`meeting-${r.booking_id}-mobile`} disabled={status === 'hidden'} aria-label={`${status} ${r.slot_start ? formatNiceDateTime(r.slot_start, r.time_zone) : ''}`} checked={selSet.has(r.booking_id!)} onChange={() => toggleMeeting(client.contact_id, r.booking_id!)} className="mt-1" /> : null}
                              <div className="flex-1 min-w-0">
                                <div className="font-medium text-sm">{r.slot_start ? formatNiceDateTime(r.slot_start, r.time_zone) : '-'}</div>
                                <div className="text-xs text-slate-500">
                                  {(() => {
                                    const p = r.purpose || 'No purpose'
                                    const id = (r.booking_id || `${r.contact_id}-${r.slot_start}`) + '-m'
                                    const expanded = !!expandedPurpose[id]
                                    const needsClamp = p.length > 80
                                    return <><span title={p}>{needsClamp && !expanded ? p.slice(0, 80) + '...' : p}</span>{needsClamp && <button type="button" onClick={() => setExpandedPurpose((prev) => ({ ...prev, [id]: !prev[id] }))} className="ml-1 text-blue-600 underline">{expanded ? 'less' : 'more'}</button>}{' · '}{getStatusChip(status)}</>
                                  })()}
                                </div>
                                {r.meet_link && <a href={r.meet_link} target="_blank" rel="noopener noreferrer" className="text-xs text-blue-600 underline break-all">{r.meet_link}</a>}
                                <div className="mt-2">{renderRowActions(client, r)}</div>
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
