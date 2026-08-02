/**
 * Development-only tracing.
 *
 * The `!!!`-prefixed traces are a debugging aid, not something a visitor should see —
 * and some of them carry the name and email typed into the booking form, which must
 * never reach a public page's console.
 */
export function debug(message: string): void {
  if (import.meta.env.DEV) console.log(message)
}
