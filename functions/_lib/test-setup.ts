// Vitest setup for workers — suppress !!! traces that flood `docker compose run tests`
// M3: This is intentionally narrow — only strings starting with "!!!" are hidden.
// Real errors must NOT use !!! prefix; use "[Component FAILED]" etc (see email.ts, google-calendar.ts)
// so they remain visible. If you add a new !!! log for live debugging, it will be silent in tests by design.

function patchConsole(method: 'log' | 'debug' | 'info' | 'warn' | 'error') {
  const orig = (console as any)[method] as (...args: any[]) => void
  if (!orig) return
  ;(console as any)[method] = (...args: any[]) => {
    const first = typeof args[0] === 'string' ? args[0] : ''
    if (first.startsWith('!!!')) return
    orig(...args)
  }
}

patchConsole('log')
patchConsole('debug')
patchConsole('info')
patchConsole('warn')
patchConsole('error')

