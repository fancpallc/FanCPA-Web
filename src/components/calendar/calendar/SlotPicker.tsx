import React, { useMemo } from 'react'
import type { CalendarSlot } from '../../lib/api'
import { TIMEZONE } from '../../lib/constants'
import { formatSlotInterval } from '../../lib/datetime'

export interface SlotPickerProps {
  date: string
  slots: CalendarSlot[]
  onSlotSelect: (slot: CalendarSlot) => void
  onClose?: () => void
  slotMinutes?: number
}

function formatDateLong(dateStr: string): string {
  try {
    // A YYYY-MM-DD slot date is a plain calendar date. `new Date('2026-08-03')`
    // parses as UTC midnight, so rendering it in Eastern rolled it back to Aug 2
    // and the picker heading disagreed with the day the visitor clicked.
    const [year, month, day] = dateStr.split('-').map(Number)
    if (!year || !month || !day) return dateStr
    return new Date(Date.UTC(year, month - 1, day)).toLocaleDateString('en-US', {
      weekday: 'long',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    })
  } catch {
    return dateStr
  }
}

export function SlotPicker({ date, slots, onSlotSelect, onClose, slotMinutes = 30 }: SlotPickerProps) {
  const { morning, afternoon, availableCount } = useMemo(() => {
    const available = slots.filter((s) => s.available)
    const morning: CalendarSlot[] = []
    const afternoon: CalendarSlot[] = []
    available.forEach((s) => {
      // Display grouping in Eastern timezone hours
      const hour = new Date(s.start).toLocaleString('en-US', { hour: 'numeric', hour12: false, timeZone: TIMEZONE }) as any
      const h = parseInt(String(hour), 10)
      if (h < 12) morning.push(s)
      else afternoon.push(s)
    })
    return { morning, afternoon, availableCount: available.length }
  }, [slots])

  if (!slots || slots.length === 0) {
    return (
      <div className="card rounded-2xl p-6 bg-white text-center w-full">
        <div className="w-10 h-10 rounded-full bg-slate-50 border mx-auto flex items-center justify-center mb-3">📅</div>
        <div className="text-sm font-semibold">No slots for {formatDateLong(date)}</div>
        <div className="text-xs text-gray-500 mt-1">Try another day in the next two weeks.</div>
        {onClose && (
          <button onClick={onClose} className="mt-4 px-4 py-2 rounded-full border text-xs font-medium hover:bg-gray-50">
            Close
          </button>
        )}
      </div>
    )
  }

  return (
    <div className="card rounded-2xl p-6 bg-white shadow-sm w-full relative">
      <div className="flex justify-between items-start gap-3 mb-5">
        <div>
          <div className="font-bold text-base tracking-tight">{formatDateLong(date)}</div>
          <div className="text-xs text-gray-500 mt-1">{availableCount} times available · {slotMinutes} minutes each</div>
        </div>
        {onClose && (
          <button onClick={onClose} aria-label="Close time slots" className="w-11 h-11 rounded-full border border-slate-500 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center text-sm focus:outline-none focus:ring-2">
            ✕
          </button>
        )}
      </div>

      {availableCount === 0 ? (
        <div className="text-sm text-gray-500 py-4 text-center">
          <div>All slots booked for this day</div>
          {onClose && (
            <button onClick={onClose} className="mt-3 px-4 py-2 rounded-full bg-slate-900 text-white text-xs">
              Close
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-5">
          {morning.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-3 font-semibold">Morning</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {morning.map((slot) => (
                  <button
                    key={slot.start}
                    onClick={() => onSlotSelect(slot)}
                    className="px-3 min-h-11 inline-flex items-center justify-center rounded-full border border-slate-500 bg-white text-slate-900 text-xs font-medium hover:bg-slate-900 hover:text-white hover:border-slate-900 hover:z-10 relative focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:ring-slate-900 transition-colors leading-none truncate"
                  >
                    {formatSlotInterval(slot.start, slot.end)}
                  </button>
                ))}
              </div>
            </div>
          )}
          {afternoon.length > 0 && (
            <div>
              <div className="text-[11px] uppercase tracking-widest text-gray-400 mb-3 font-semibold">Afternoon</div>
              <div className="grid grid-cols-1 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                {afternoon.map((slot) => (
                  <button
                    key={slot.start}
                    onClick={() => onSlotSelect(slot)}
                    className="px-3 min-h-11 inline-flex items-center justify-center rounded-full border border-slate-500 bg-white text-slate-900 text-xs font-medium hover:bg-slate-900 hover:text-white hover:border-slate-900 hover:z-10 relative focus:outline-none focus-visible:ring-1 focus-visible:ring-offset-1 focus-visible:ring-slate-900 transition-colors leading-none truncate"
                  >
                    {formatSlotInterval(slot.start, slot.end)}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  )
}
