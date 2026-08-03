import { TIMEZONE } from './constants'

/** "5:00 PM" in the booking timezone. */
export function formatTime(iso: string, timeZone: string = TIMEZONE): string {
  return new Date(iso).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', hour12: true, timeZone })
}

/**
 * "5:00 – 5:30 PM" — the meridiem is dropped from the start only when both ends
 * share it. A bare "1:00 - 1:30" in a list that starts at "9:00" reads as morning.
 */
export function formatSlotInterval(startIso: string, endIso: string, timeZone: string = TIMEZONE): string {
  const start = formatTime(startIso, timeZone)
  const end = formatTime(endIso, timeZone)
  const startMeridiem = start.slice(-2)
  const compactStart = startMeridiem === end.slice(-2) ? start.slice(0, -2).trim() : start
  return `${compactStart} – ${end}`
}

/** "Tuesday, August 4 · 5:00 – 5:30 PM". */
export function formatSlotRange(startIso: string, endIso: string, timeZone: string = TIMEZONE): string {
  const day = new Date(startIso).toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', timeZone })
  return `${day} · ${formatSlotInterval(startIso, endIso, timeZone)}`
}
