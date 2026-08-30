import React, { useState, useRef } from 'react'
import { Layout } from '../components/common/Layout'
import { lookupClientPortal } from '../lib/api'

declare global {
  interface Window {
    turnstile: any
    TURNSTILE_SITE_KEY?: string
  }
}

export default function ClientPortal() {
  const [email, setEmail] = useState('')
  const [status, setStatus] = useState<'idle' | 'loading' | 'success' | 'error'>('idle')
  const [errorMsg, setErrorMsg] = useState('')
  const [turnstileToken, setTurnstileToken] = useState<string | null>(null)
  const [turnstileReady, setTurnstileReady] = useState(false)
  const [turnstileFailed, setTurnstileFailed] = useState(false)
  const widgetIdRef = useRef<string | null>(null)
  const retryCountRef = useRef(0)

  const isLocalEnv = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')

  const renderTurnstile = React.useCallback(() => {
    const w = window as any
    if (!w.turnstile) return false
    const siteKey = w.TURNSTILE_SITE_KEY
    if (!siteKey) {
      // In local dev, allow bypass
      if (isLocalEnv) {
        setTurnstileToken('fake-token-for-test')
        setTurnstileReady(true)
        return true
      }
      return false
    }
    try {
      // Avoid double-render
      const container = document.getElementById('client-portal-turnstile-widget')
      if (!container) return false
      if (widgetIdRef.current) {
        try {
          w.turnstile.reset(widgetIdRef.current)
          return true
        } catch {
          // fallthrough to render
        }
      }
      const id = w.turnstile.render('#client-portal-turnstile-widget', {
        sitekey: siteKey,
        callback: (token: string) => setTurnstileToken(token),
        'expired-callback': () => {
          setTurnstileToken(null)
          setErrorMsg('Verification expired — please complete the challenge again.')
        },
        'error-callback': () => {
          setTurnstileToken(null)
        },
      })
      widgetIdRef.current = id
      setTurnstileReady(true)
      return true
    } catch {
      return false
    }
  }, [isLocalEnv])

  React.useEffect(() => {
    // Local/test bypass for dev
    if (isLocalEnv) {
      setTurnstileToken('fake-token-for-test')
      setTurnstileReady(true)
    }

    if (renderTurnstile()) return

    // Turnstile script loads async defer — retry with backoff (same pattern as BookingForm)
    let timer: number
    const attempt = () => {
      if (renderTurnstile()) return
      retryCountRef.current++
      if (retryCountRef.current > 20) {
        if (isLocalEnv) {
          setTurnstileToken('fake-token-for-test')
          setTurnstileReady(true)
        } else {
          // Terminal failure — surface to user instead of dead disabled button
          setTurnstileFailed(true)
          setErrorMsg("Couldn't load verification — refresh to try again.")
        }
        return
      }
      timer = window.setTimeout(attempt, retryCountRef.current < 5 ? 300 : 1000)
    }
    timer = window.setTimeout(attempt, 500)
    return () => window.clearTimeout(timer)
  }, [renderTurnstile, isLocalEnv])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!turnstileToken) return

    setStatus('loading')
    setErrorMsg('')
    try {
      await lookupClientPortal({ email, turnstileToken })
      setStatus('success')
    } catch (err: any) {
      const httpStatus = err?.status || 0
      const msg = (err?.body?.error || err?.message || '').toString()
      const lower = msg.toLowerCase()
      // Turnstile token invalid → show specific error and reset widget
      if (lower.includes('turnstile') || httpStatus === 400) {
        setStatus('error')
        setErrorMsg(msg || 'Verification failed — please try again.')
        try {
          if (widgetIdRef.current && window.turnstile?.reset) window.turnstile.reset(widgetIdRef.current)
        } catch {}
        setTurnstileToken(null)
        return
      }
      // Transport / server errors (5xx, network) must NOT be reported as success
      if (httpStatus >= 500 || lower.includes('network') || lower.includes('timeout') || lower.includes('aborted') || httpStatus === 0) {
        setStatus('error')
        setErrorMsg('Something went wrong — please try again. If it continues, contact us.')
        return
      }
      // Anti-enumeration: for 200 generic-success (including not-found) we intentionally show success
      // 4xx other than Turnstile (e.g. 429) should surface as error
      if (httpStatus >= 400 && httpStatus < 500) {
        setStatus('error')
        setErrorMsg(msg || 'Request failed — please try again.')
        return
      }
      setStatus('success')
    }
  }

  const resetForm = () => {
    setStatus('idle')
    setErrorMsg('')
    // Keep email for resend convenience, but allow editing
  }

  return (
    <Layout title="Client Portal">
      <div className="max-w-md mx-auto p-6">
        <h1 className="text-2xl font-bold mb-2">Access your documents</h1>
        <p className="text-sm text-slate-600 mb-4">
          Enter your email and we'll send you a secure link with your documents folder and upcoming meetings.
        </p>
        {status === 'success' ? (
          <div className="rounded-xl border border-green-200 bg-green-50 p-4 space-y-3">
            <p className="text-green-700">If an account with that email exists, we have sent a link to your inbox.</p>
            <p className="text-xs text-slate-600">
              It should arrive within a couple of minutes. Check your spam folder if you don't see it, and contact us if it doesn't arrive.
            </p>
            <div className="flex flex-wrap gap-3 mt-2">
              <button type="button" onClick={resetForm} className="text-sm text-slate-700 underline min-h-11">
                Send to a different email
              </button>
              <button
                type="button"
                onClick={() => {
                  setStatus('idle')
                }}
                className="text-sm text-slate-700 underline min-h-11"
              >
                Resend
              </button>
              <a href="/" className="inline-flex text-sm text-slate-600 underline min-h-11 items-center">
                Back to home
              </a>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="space-y-4">
            {status === 'error' && errorMsg && <p className="text-red-600 text-sm rounded bg-red-50 p-2 border border-red-200">{errorMsg}</p>}
            {turnstileFailed && (
              <div className="rounded bg-amber-50 border border-amber-200 p-2 text-sm text-amber-800">
                Couldn't load verification — <button type="button" onClick={() => window.location.reload()} className="underline font-medium">refresh to try again</button>.
              </div>
            )}
            <label htmlFor="client-portal-email" className="block text-sm font-medium">
              Email
            </label>
            <input
              id="client-portal-email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@example.com"
              className="w-full p-2 border rounded"
              required
              aria-label="Email address for document access"
            />
            <div id="client-portal-turnstile-widget" className="min-h-[65px]" role="group" aria-label="Bot verification challenge" />
            {!turnstileReady && !turnstileFailed && !isLocalEnv && <p className="text-xs text-slate-500">Loading verification…</p>}
            <button
              type="submit"
              disabled={!turnstileToken || status === 'loading' || turnstileFailed}
              className="w-full p-2 bg-slate-900 text-white rounded-full disabled:bg-gray-400 min-h-11 font-semibold"
            >
              {status === 'loading' ? 'Processing…' : 'Send Access Link'}
            </button>
            <a href="/" className="block text-center text-sm text-slate-500 underline mt-2">
              Back to home
            </a>
          </form>
        )}
      </div>
    </Layout>
  )
}
