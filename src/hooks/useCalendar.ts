import { useEffect, useState, useMemo, useCallback } from 'react'
import { fetchSlotsFull, type CalendarSlot, type FetchOptions } from '../lib/api'
import { debug } from '../lib/debug'

export interface UseCalendarReturn {
  slots: CalendarSlot[]
  grouped: Record<string, CalendarSlot[]>
  loading: boolean
  error: string | null
  slotMinutes: number
  excludeToday: boolean
  refetch: () => Promise<void>
  removeSlot: (slot: CalendarSlot | { start: string; end: string; date?: string }) => void
}

export function useCalendar(weeks: number = 2, options?: FetchOptions): UseCalendarReturn {
  const [slots, setSlots] = useState<CalendarSlot[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [slotMinutes, setSlotMinutes] = useState(30)
  const [excludeToday, setExcludeToday] = useState(true) // default true per requirement assume dont schedule today

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      debug(`!!! USECALENDAR_FETCH_START weeks=${weeks}`)
      const full = await fetchSlotsFull(weeks, options)
      debug(`!!! USECALENDAR_FETCH_RESULT slots=${full.slots.length} source=${full.source}`)
      setSlots(full.slots)
      // Configurable slot duration multiple of 15 per requirement, from API workingHours
      if (full.workingHours?.slotMinutes) {
        setSlotMinutes(full.workingHours.slotMinutes)
      }
      if (full.workingHours?.excludeToday !== undefined) {
        setExcludeToday(!!full.workingHours.excludeToday)
      }
    } catch (e: any) {
      debug(`!!! USECALENDAR_FETCH_ERROR ${e.message}`)
      setError(e.message || String(e))
      setSlots([])
    } finally {
      setLoading(false)
    }
  }, [weeks])

  const removeSlot = useCallback((slotToRemove: CalendarSlot | { start: string; end: string; date?: string }) => {
    debug(`!!! USECALENDAR_REMOVE_SLOT start=${slotToRemove.start} optimistic removal to prevent stale display until reload`)
    setSlots((prev) => prev.filter((s) => s.start !== slotToRemove.start))
  }, [])

  useEffect(() => {
    fetch()
  }, [fetch])

  const grouped = useMemo(() => {
    const map: Record<string, CalendarSlot[]> = {}
    slots.forEach((s) => {
      if (!map[s.date]) map[s.date] = []
      map[s.date].push(s)
    })
    return map
  }, [slots])

  return { slots, grouped, loading, error, slotMinutes, excludeToday, refetch: fetch, removeSlot }
}
