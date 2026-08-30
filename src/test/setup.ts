import '@testing-library/jest-dom/vitest'

// Silence the !!!-prefixed debug traces in tests — they are for live debugging,
// not for test output. Also suppress noisy React act() warnings from pre-existing tests.
// Real errors must NOT use !!! prefix — use non-prefixed format so they stay visible.

function patchConsole(method: 'log' | 'debug' | 'info' | 'warn' | 'error') {
  const orig = (console as any)[method] as (...args: any[]) => void
  if (!orig) return
  ;(console as any)[method] = (...args: any[]) => {
    const first = typeof args[0] === 'string' ? args[0] : ''
    if (first.startsWith('!!!')) return
    if (method === 'error' && first.includes('was not wrapped in act')) return
    orig(...args)
  }
}

patchConsole('log')
patchConsole('debug')
patchConsole('info')
patchConsole('warn')
patchConsole('error')

