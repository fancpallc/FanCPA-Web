import React from 'react'
import type { CalendarSlot } from '../../lib/api'
import { TIMEZONE, TIMEZONE_LABEL } from '../../lib/constants'

export interface CalendarViewProps {
  grouped: Record<string, CalendarSlot[]>
  selectedDate: string | null
  onDateSelect: (date: string) => void
  excludeToday?: boolean
  slotMinutes?: number
}

const DAY_MS = 24 * 60 * 60 * 1000

/**
 * Today in {@link TIMEZONE}, anchored to UTC midnight.
 *
 * Every date in the grid is a UTC-midnight instant standing for an Eastern calendar
 * day, and every read of it (weekday, day number, month, key) uses `timeZone: 'UTC'`.
 * Mixing the two — local-time arithmetic with Eastern-time rendering — is what used
 * to put "SAT 1 Aug" under the "SUN" column for anyone west of Eastern.
 */
function etToday(): Date {
  const [year, month, day] = new Date().toLocaleDateString('en-CA', { timeZone: TIMEZONE }).split('-').map(Number)
  return new Date(Date.UTC(year, month - 1, day))
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * DAY_MS)
}

function toDateStr(date: Date): string {
  return date.toISOString().slice(0, 10)
}

function getNext14Range(excludeToday: boolean): { start: Date; end: Date; selectableSet: Set<string> } {
  const start = addDays(etToday(), excludeToday ? 1 : 0)
  const end = addDays(start, 13)
  const selectableSet = new Set<string>()
  for (let i = 0; i < 14; i++) selectableSet.add(toDateStr(addDays(start, i)))
  return { start, end, selectableSet }
}

function getCalendarGrid(excludeToday: boolean): { weeks: Date[][]; selectableSet: Set<string> } {
  const { start, end, selectableSet } = getNext14Range(excludeToday)
  const gridStart = addDays(start, -start.getUTCDay())
  const gridEnd = addDays(end, 6 - end.getUTCDay())
  const weeks: Date[][] = []
  for (let d = gridStart; d <= gridEnd && weeks.length < 3; d = addDays(d, 7)) {
    weeks.push(Array.from({ length: 7 }, (_, i) => addDays(d, i)))
  }
  return { weeks, selectableSet }
}

function formatDayShort(date: Date): { dow: string; day: string; month: string; dateStr: string; isToday: boolean } {
  const opts = { timeZone: 'UTC' } as const
  return {
    dow: date.toLocaleDateString('en-US', { weekday: 'short', ...opts }).toUpperCase(),
    day: date.toLocaleDateString('en-US', { day: 'numeric', ...opts }),
    month: date.toLocaleDateString('en-US', { month: 'short', ...opts }),
    dateStr: toDateStr(date),
    isToday: toDateStr(date) === toDateStr(etToday()),
  }
}

export function CalendarView({ grouped, selectedDate, onDateSelect, excludeToday = true, slotMinutes = 30 }: CalendarViewProps) {
  const { weeks, selectableSet } = getCalendarGrid(excludeToday)

  // The badge used to read a flat "Booking opens from tomorrow". On a Friday or a
  // Saturday tomorrow is a disabled weekend cell in the very same card, so the badge
  // contradicted the grid two days in seven. Naming the first day that actually has
  // slots is both correct every day and more useful than "tomorrow" on any of them.
  const firstOpenDay = weeks
    .flat()
    .filter((d) => selectableSet.has(toDateStr(d)) && ![0, 6].includes(d.getUTCDay()))
    .find((d) => (grouped[toDateStr(d)] || []).some((s) => s.available))

  return (
    <div className="card rounded-2xl p-3 sm:p-6 md:p-8 bg-white shadow-sm w-full">
      <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-6">
        <div>
          <h3 className="text-xl font-black tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
            Available times
          </h3>
          <p className="text-xs text-gray-500 mt-1">
            Pick a weekday in the next two weeks · {slotMinutes}-minute meetings · times shown in {TIMEZONE_LABEL}
          </p>
        </div>
        {excludeToday && firstOpenDay && (
          <span className="px-4 py-2 rounded-full bg-amber-50 border border-amber-200 text-xs text-amber-700 leading-none">
            First opening: {firstOpenDay.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'long', month: 'long', day: 'numeric' })}
          </span>
        )}
      </div>

      <div className="grid grid-cols-7 gap-1.5 sm:gap-3 mb-3">
        {['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'].map((d) => (
          <div key={d} className="text-center text-[11px] uppercase tracking-widest font-semibold text-gray-400">
            {d}
          </div>
        ))}
      </div>

      {/* At 393px the pills are too narrow for "16 slots", so the word is dropped —
          this caption explains the bare number to sighted mobile users. */}
      <p className="sm:hidden text-[11px] text-gray-500 mb-3">The number on each day is how many free slots it has.</p>

      <div className="space-y-3">
        {weeks.map((week, wi) => (
          <div key={wi} className="grid grid-cols-7 gap-1.5 sm:gap-3">
            {week.map((d) => {
              const { dow, day, month, dateStr, isToday } = formatDayShort(d)
              const daySlots = grouped[dateStr] || []
              const availableCount = daySlots.filter((s) => s.available).length
              const hasAvailability = availableCount > 0
              const isSelected = selectedDate === dateStr
              const isWeekend = [0, 6].includes(d.getUTCDay())
              const isSelectable = selectableSet.has(dateStr) && !isWeekend && hasAvailability
              const isOutsideSelectable = !selectableSet.has(dateStr)

              return (
                <button
                  key={dateStr}
                  onClick={() => isSelectable && onDateSelect(dateStr)}
                  disabled={!isSelectable}
                  aria-selected={isSelected}
                  aria-label={`${dow} ${month} ${day}${isSelectable ? ` — ${availableCount} slots available` : isWeekend ? ' — weekend, unavailable' : ' — unavailable'}`}
                  className={`flex flex-col items-center justify-start py-3 sm:py-4 px-1 sm:px-2 rounded-2xl border transition-all min-h-[92px] sm:min-h-[96px]
                    ${isWeekend ? 'bg-gray-50 text-gray-400 border-gray-100 opacity-60' : ''}
                    ${isOutsideSelectable ? 'bg-white text-gray-300 border-gray-100 opacity-40' : ''}
                    ${!isWeekend && !isOutsideSelectable && !hasAvailability ? 'bg-gray-50 text-gray-400 border-gray-100 opacity-60' : ''}
                    ${hasAvailability && isSelectable && !isSelected ? 'bg-white border-slate-500 hover:border-slate-900 hover:shadow-md' : ''}
                    ${isSelected ? 'bg-slate-900 text-white border-slate-900 shadow-md scale-[1.02]' : ''}
                    ${!isSelectable ? 'cursor-not-allowed' : 'cursor-pointer'}`}
                >
                  {/* The weekday lives in the aligned column header, not in every cell. */}
                  <div className="text-[18px] sm:text-[20px] font-bold leading-none">{day}</div>
                  <div className={`text-[10px] sm:text-[11px] mt-1 ${isSelected ? 'text-slate-300' : 'text-gray-500'}`}>{month}</div>
                  {isToday && !excludeToday && !isOutsideSelectable ? (
                    <div className={`mt-2 px-4 py-1.5 rounded-full text-[10px] font-medium leading-none ${isSelected ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}`}>
                      Today
                    </div>
                  ) : null}
                  {isToday && excludeToday && (
                    <div className="mt-2 px-3 py-1 rounded-full text-[9px] bg-amber-100 border border-amber-200 text-amber-700 leading-none">
                      No bookings today
                    </div>
                  )}
                  {/* At 393px a cell is ~35px wide, so "16 slots" / "Weekend" used to
                      spill across the cell borders into the neighbouring days. The full
                      wording lives in the button's aria-label either way. */}
                  <div className="mt-2 max-w-full">
                    {hasAvailability && selectableSet.has(dateStr) ? (
                      <span className={`inline-block px-2 sm:px-3 py-1 rounded-full text-[10px] sm:text-[11px] leading-none ${isSelected ? 'bg-white text-slate-900' : 'bg-slate-900 text-white'}`}>
                        {availableCount}<span className="hidden sm:inline"> slots</span>
                      </span>
                    ) : (
                      <span className="text-[10px] sm:text-[11px] text-gray-400">
                        {isWeekend ? (<><span className="sm:hidden">Wknd</span><span className="hidden sm:inline">Weekend</span></>) : isOutsideSelectable ? '' : 'Full'}
                      </span>
                    )}
                  </div>
                </button>
              )
            })}
          </div>
        ))}
      </div>

    </div>
  )
}
