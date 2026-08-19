// We need to implement a "Minimum Notice Days" feature.
// It will be configurable via environment variables or a DB setting.
// The user has requested "0 days before" means you can book on the same day, 1 means no same-day bookings, etc.

// Current implementation uses EXCLUDE_TODAY and `getNext14Days` with logic to filter out the current day.
// We should add a new `MINIMUM_NOTICE_DAYS` setting.

// 0: means include today (if not already past)
// 1: means exclude today (same as current behavior)
// 2: means exclude today and tomorrow, etc.

// I will need to update `functions/api/calendar/slots.ts` to read this value and `functions/_lib/google-calendar.ts` to implement the logic.
