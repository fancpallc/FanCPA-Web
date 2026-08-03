import React, { useState, useEffect } from 'react'
import type { CalendarSlot } from '../../lib/api'
import { createBooking } from '../../lib/api'
import { generateIcsContent, downloadIcsFile } from '../../lib/ics'
import { formatSlotRange } from '../../lib/datetime'
import { debug } from '../../lib/debug'
import { BOOKING_MESSAGES } from '../../lib/bookingMessages'

export interface BookingFormProps {
  slot: CalendarSlot
  onSuccess: (data: { meetLink: string; dateTime: string; cancelUrl: string; source?: string; gcalError?: string; emailResult?: any; pending?: boolean }) => void
  onCancel?: () => void
}

export function BookingForm({ slot, onSuccess, onCancel }: BookingFormProps) {
  const [firstName, setFirstName] = useState('')
  const [lastName, setLastName] = useState('')
  const [email, setEmail] = useState('')
  const [phone, setPhone] = useState('')
  const [purpose, setPurpose] = useState('')
  // Start empty — real token from Turnstile widget in prod/alpha, fake only for local/test (TDD)
  const [turnstileToken, setTurnstileToken] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [warning, setWarning] = useState<string | null>(null)
  const [confirmIntent, setConfirmIntent] = useState(false)
  const [success, setSuccess] = useState<{ meetLink: string; dateTime: string; cancelUrl: string; source?: string; gcalError?: string; emailResult?: any; pending?: boolean; message?: string; purpose?: string | null } | null>(null)
  const [pending, setPending] = useState<{ email: string; dateTime: string; purpose?: string | null; message: string; confirmUrl?: string; emailResult?: any } | null>(null)
  const [challengeFailed, setChallengeFailed] = useState(false)
  const [needsInteraction, setNeedsInteraction] = useState(false)

  // Load Turnstile widget — real token for alpha/prod, fake stub for local/test (so TDD not blocked)
  // Store widgetId for reset
  const widgetIdRef = React.useRef<string | number | null>(null)
  const tokenRef = React.useRef('')
  tokenRef.current = turnstileToken

  const renderTurnstile = React.useCallback(() => {
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    if (isLocalHost) {
      debug('!!! TURNSTILE_FORM_LOCALHOST fake token')
      setTurnstileToken('fake-token-for-test')
      return true
    }
    const siteKey = (window as any)?.TURNSTILE_SITE_KEY || '0x4AAAAAAD8-3h6x-RUDasMf'
    if (typeof window !== 'undefined' && (window as any).turnstile) {
      try {
        debug(`!!! TURNSTILE_FORM_RENDER_START siteKey=${siteKey}`)
        const existing = document.querySelector('#turnstile-widget')
        if (existing) existing.innerHTML = ''
        // Reset previous if any
        if (widgetIdRef.current !== null) {
          try {
            ;(window as any).turnstile.remove(widgetIdRef.current)
          } catch {}
        }
        const id = (window as any).turnstile.render('#turnstile-widget', {
          sitekey: siteKey,
          callback: (token: string) => {
            debug(`!!! TURNSTILE_FORM_CALLBACK tokenLen=${token.length}`)
            setTurnstileToken(token)
          },
          'before-interactive-callback': () => setNeedsInteraction(true),
          'after-interactive-callback': () => setNeedsInteraction(false),
          'error-callback': () => {
            debug('!!! TURNSTILE_FORM_ERROR_CALLBACK')
            setTurnstileToken('')
          },
          'expired-callback': () => {
            debug('!!! TURNSTILE_FORM_EXPIRED_CALLBACK')
            setTurnstileToken('')
          },
        })
        widgetIdRef.current = id
        debug(`!!! TURNSTILE_FORM_RENDERED widgetId=${String(id)}`)
        return true
      } catch (e: any) {
        debug(`!!! TURNSTILE_FORM_RENDER_FAILED ${e?.message}`)
        return false
      }
    }
    debug('!!! TURNSTILE_FORM_NOT_READY window.turnstile missing')
    return false
  }, [])

  const resetTurnstile = React.useCallback(() => {
    debug('!!! TURNSTILE_FORM_RESET_START')
    setTurnstileToken('')
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    if (isLocalHost) {
      debug('!!! TURNSTILE_FORM_RESET_LOCALHOST fake token')
      setTurnstileToken('fake-token-for-test')
      return
    }
    try {
      if (widgetIdRef.current !== null && (window as any)?.turnstile) {
        debug(`!!! TURNSTILE_FORM_RESET widgetId=${String(widgetIdRef.current)}`)
        ;(window as any).turnstile.reset(widgetIdRef.current)
      } else {
        debug('!!! TURNSTILE_FORM_RESET_NO_ID re-render')
        renderTurnstile()
      }
    } catch (e: any) {
      debug(`!!! TURNSTILE_FORM_RESET_FAILED ${e?.message} fallback re-render`)
      // Fallback re-render
      renderTurnstile()
    }
  }, [renderTurnstile])

  useEffect(() => {
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    if (isLocalHost) {
      setTurnstileToken('fake-token-for-test')
      return
    }
    renderTurnstile()
    const interval = setInterval(() => {
      if (renderTurnstile()) clearInterval(interval)
    }, 500)
    // Cloudflare can be blocked or simply never answer. Without this the visitor gets a
    // permanently rejected form and no explanation. Read the token through a ref so a
    // delivered token doesn't restart the widget.
    const giveUp = setTimeout(() => {
      clearInterval(interval)
      if (!tokenRef.current) setChallengeFailed(true)
    }, 10000)
    return () => {
      clearInterval(interval)
      clearTimeout(giveUp)
    }
  }, [renderTurnstile])

  /**
   * Every problem at once. This used to return the first failure only, so submitting an
   * empty form said "First name is required", and the visitor had to submit three more
   * times to discover the other three fields.
   */
  const validate = (): string | null => {
    const problems: string[] = []
    if (!firstName.trim()) problems.push('First name is required')
    if (!lastName.trim()) problems.push('Last name is required')
    if (!email.trim()) problems.push('Email is required')
    else if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) problems.push('Invalid email format')
    if (!slot?.start || !slot?.end) problems.push('Slot is required')
    const isLocalHost = typeof window !== 'undefined' && (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1')
    if (!isLocalHost && !turnstileToken) problems.push('Please finish the spam check above, then try again.')
    return problems.length ? problems.join('. ') : null
  }

  const doBooking = async (intentOverride?: boolean) => {
    debug(`!!! BOOKING_FORM_DO_BOOKING_START firstName=${firstName} email=${email} slot=${slot.start} purpose=${purpose || 'none'} confirmIntent=${intentOverride ?? confirmIntent} hasToken=${!!turnstileToken}`)
    const v = validate()
    if (v) {
      debug(`!!! BOOKING_FORM_VALIDATION_FAILED ${v}`)
      setError(v)
      return null
    }
    setLoading(true)
    setError(null)
    setPending(null)
    try {
      debug('!!! BOOKING_FORM_API_CALL_START')
      const result = await createBooking({
        firstName,
        lastName,
        email,
        phone: phone || undefined,
        purpose: purpose || undefined,
        slot,
        turnstileToken,
        confirmIntent: intentOverride ?? confirmIntent,
      })
      debug(`!!! BOOKING_FORM_API_RESULT warning=${!!(result as any).warning} pending=${!!(result as any).pending} meetLink=${result.meetLink} source=${result.source} gcalError=${result.gcalError || 'none'} emailSuccess=${result.emailResult?.success}`)
      // Handle duplicate warning same email this week — token is consumed by first verify, need new token for confirm
      if ((result as any).warning) {
        debug(`!!! BOOKING_FORM_DUPLICATE_WARNING ${(result as any).warning}`)
        setWarning((result as any).warning)
        setConfirmIntent(true)
        // Turnstile tokens are single-use (Cloudflare invalidates after siteverify) — reset for confirm flow
        resetTurnstile()
        return null
      }
      // Double opt-in pending — show check email message per requirement
      if ((result as any).pending) {
        debug(`!!! BOOKING_FORM_PENDING email=${(result as any).email} dateTime=${result.dateTime} purpose=${(result as any).purpose || 'none'} confirmUrl=${(result as any).confirmUrl || 'none'} emailSuccess=${result.emailResult?.success}`)
        setPending({
          email: (result as any).email || email,
          dateTime: (result as any).dateTime,
          purpose: (result as any).purpose,
          message: (result as any).message || `Check your email (${email}) to confirm`,
          confirmUrl: (result as any).confirmUrl,
          emailResult: (result as any).emailResult,
        })
        return result
      }
      debug(`!!! BOOKING_FORM_SUCCESS meetLink=${result.meetLink} source=${result.source} purpose=${purpose}`)
      setSuccess({
        meetLink: result.meetLink,
        dateTime: result.dateTime,
        cancelUrl: result.cancelUrl,
        source: result.source,
        gcalError: result.gcalError,
        emailResult: result.emailResult,
        purpose: purpose || null,
      })
      onSuccess({
        meetLink: result.meetLink,
        dateTime: result.dateTime,
        cancelUrl: result.cancelUrl,
        source: result.source,
        gcalError: result.gcalError,
        emailResult: result.emailResult,
        pending: false,
      })
      return result
    } catch (err: any) {
      const msg = err.body?.error || err.message || 'Booking failed'
      debug(`!!! BOOKING_FORM_ERROR ${msg} body=${JSON.stringify(err.body || {}).slice(0, 300)}`)
      const bodyStr = JSON.stringify(err.body || {})
      setError(msg)
      // If Turnstile failed (token reused/expired), reset for retry
      if (bodyStr.toLowerCase().includes('turnstile') || msg.toLowerCase().includes('turnstile')) {
        debug('!!! BOOKING_FORM_TURNSTILE_FAIL_RESET')
        resetTurnstile()
      }
      return null
    } finally {
      setLoading(false)
      debug('!!! BOOKING_FORM_DO_BOOKING_END')
    }
  }

  const handleSubmit = async (e: React.FormEvent) => {
    debug('!!! BOOKING_FORM_HANDLE_SUBMIT')
    e.preventDefault()
    setWarning(null)
    await doBooking()
  }

  const handleConfirmAndBookAgain = async () => {
    debug('!!! BOOKING_FORM_CONFIRM_AND_BOOK_AGAIN_CLICK')
    // User confirms intent to book again this week — immediately rebook with confirmIntent=true
    setConfirmIntent(true)
    setWarning(null)
    setError(null)
    await doBooking(true)
  }

  if (pending) {
    const isEmailFail = pending.emailResult && !pending.emailResult.success
    return (
      <div className="card rounded-2xl p-6 bg-blue-50 border-blue-300">
        <h3 className="font-bold text-lg mb-2">Check your email 📧</h3>
        <p className="text-sm mb-2">{pending.message}</p>
        <p className="text-sm mb-2">Email: <strong>{pending.email}</strong></p>
        <p className="text-sm mb-2">Date: {pending.dateTime}</p>
        {pending.purpose && <p className="text-sm mb-3">Purpose: <strong>{pending.purpose}</strong></p>}
        {pending.confirmUrl && (
          <div className="mt-3 p-3 bg-white border rounded-lg">
            <p className="text-xs font-semibold mb-1">Confirm link (for testing when email fails):</p>
            <a href={pending.confirmUrl} className="text-xs underline break-all" target="_blank" rel="noopener noreferrer">{pending.confirmUrl}</a>
            <div className="mt-2">
              <a href={pending.confirmUrl} className="inline-block px-4 py-2 bg-black text-white rounded-full text-xs font-semibold">Confirm now →</a>
            </div>
          </div>
        )}
        <p className="text-xs text-gray-600 mt-3 mb-1">We sent you a confirmation link. Click it within 30 minutes and the meeting is booked.</p>
        {isEmailFail && (
          <div className="p-2 bg-amber-50 border border-amber-200 rounded-lg text-xs text-amber-800 mt-2">
            <div className="font-semibold">⚠️ Email failed: {pending.emailResult?.error?.slice(0, 200)}</div>
            <div className="mt-1">Use the confirmation link above to finish booking.</div>
          </div>
        )}
        <p className="text-xs text-gray-500 mt-2">No email yet? Check your spam folder.</p>
        <div className="flex gap-2 mt-4">
          {onCancel && (
            <button onClick={() => { setPending(null); resetTurnstile(); }} className="px-6 py-3 border border-slate-500 rounded-full text-sm font-medium hover:bg-white">
              Back
            </button>
          )}
        </div>
      </div>
    )
  }

  if (success) {
    const isFakeMeet = success.meetLink.includes('fake-')
    const handleDownloadIcs = () => {
      const ics = generateIcsContent({
        title: `Meeting — ${firstName} ${lastName}`,
        description: `${purpose || success.purpose || 'Intro call'}\nMeet: ${success.meetLink}\nCancel: ${success.cancelUrl}\nPurpose: ${purpose || success.purpose || ''}`,
        location: success.meetLink,
        start: slot.start,
        end: slot.end,
        meetLink: success.meetLink,
        attendee: email,
      })
      downloadIcsFile(ics, `meeting-${slot.date}.ics`)
    }

    return (
      <div className="card rounded-2xl p-6 bg-green-50 border-green-300">
        <h3 className="font-bold text-lg mb-2">Meeting Confirmed ✅</h3>
        <p className="text-sm mb-2">Date: {success.dateTime}</p>
        {(success as any).purpose && <p className="text-sm mb-2">Purpose: <strong>{(success as any).purpose}</strong></p>}
        <p className="text-sm mb-3">
          Meet: <a href={success.meetLink} className="underline" target="_blank" rel="noopener noreferrer">{success.meetLink}</a>
        </p>
        {/* Neither box prints the vendor's error. Resend's 422 tells the visitor to
            "use our testing email address" and read Resend's documentation — support copy
            aimed at a developer, shown to a prospective client. It goes to the DEV console. */}
        {isFakeMeet && (
          <div className="p-3 border border-amber-300 bg-amber-50 rounded-lg text-xs text-amber-800 mb-3">
            <div className="font-semibold">{BOOKING_MESSAGES.placeholderMeetLink.heading}</div>
            <div>{BOOKING_MESSAGES.placeholderMeetLink.detail}</div>
          </div>
        )}
        {success.emailResult && !success.emailResult.success && (
          <div className="p-3 border border-orange-300 bg-orange-50 rounded-lg text-xs text-orange-800 mb-3">
            <div className="font-semibold">{BOOKING_MESSAGES.emailNotSent.heading}</div>
            <div>{BOOKING_MESSAGES.emailNotSent.detail}</div>
          </div>
        )}
        {success.emailResult && success.emailResult.success && success.emailResult.source === 'live' && (
          <div className="p-2 border border-green-200 bg-white rounded-lg text-[11px] text-green-700 mb-3">
            📧 Confirmation email sent
          </div>
        )}
        <div className="flex flex-wrap gap-3 mt-4">
          <button onClick={handleDownloadIcs} className="px-6 py-3 bg-slate-900 text-white rounded-full text-sm font-semibold hover:bg-black leading-none">
            Download invite (.ics)
          </button>
          <a href={success.cancelUrl} className="px-6 py-3 rounded-full border border-red-600 bg-white text-red-700 text-sm font-semibold hover:bg-red-50 leading-none inline-flex items-center justify-center">
            Cancel meeting
          </a>
          <button onClick={() => navigator.clipboard.writeText(success.meetLink)} className="px-6 py-3 bg-black text-white rounded-full text-sm font-medium leading-none">
            Copy Meet link
          </button>
        </div>
        {onCancel && (
          <button onClick={onCancel} className="mt-6 px-6 py-3 border border-slate-500 rounded-full text-sm font-medium hover:bg-gray-50 leading-none">
            Close
          </button>
        )}
      </div>
    )
  }

  return (
    <form onSubmit={handleSubmit} noValidate className="card rounded-2xl p-6 bg-white shadow-sm w-full max-w-xl mx-auto">
      <div className="flex justify-between items-start gap-3 mb-4">
        <div>
          <h3 className="font-bold text-lg tracking-tight">{formatSlotRange(slot.start, slot.end)}</h3>
          <p className="text-xs text-gray-500 mt-1">A calendar invite with a video link is sent as soon as you book.</p>
        </div>
        {onCancel && (
          <button type="button" onClick={onCancel} aria-label="Close" className="w-8 h-8 rounded-full border border-slate-500 bg-white text-gray-600 hover:bg-gray-50 flex items-center justify-center text-sm">
            ✕
          </button>
        )}
      </div>

      {warning && (
        <div className="p-3 border border-amber-300 bg-amber-50 rounded-lg text-sm mb-4">
          <div className="font-semibold">Confirm intent?</div>
          <div>{warning}</div>
          <div className="text-xs mt-1">You already have a booking this week. Confirm below if you'd like another.</div>
          {!turnstileToken && (
            <div className="text-[11px] text-amber-700 mt-1">Re-running the spam check…</div>
          )}
          <div className="flex gap-2 mt-2">
            <button
              type="button"
              onClick={handleConfirmAndBookAgain}
              disabled={loading || !turnstileToken}
              className="px-4 py-2 bg-black text-white rounded-full text-xs font-semibold hover:bg-gray-800 disabled:opacity-50"
            >
              {loading ? 'Booking…' : 'Confirm and book again'}
            </button>
            <button type="button" onClick={() => { setWarning(null); setConfirmIntent(false); resetTurnstile(); }} className="px-3 py-2 border border-slate-500 rounded-full text-xs bg-white hover:bg-gray-50">
              Cancel
            </button>
          </div>
        </div>
      )}

      {error && (
        // role="alert" so the failure is announced; ManageBookings already had one and
        // this box did not, so screen-reader users got silence on a failed submit.
        <div className="p-3 border border-red-300 bg-red-50 rounded-lg text-sm text-red-700 mb-4" role="alert">
          {error}
        </div>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <div>
          <label htmlFor="firstName" className="block text-xs font-semibold mb-1">First name *</label>
          <input id="firstName" type="text" value={firstName} onChange={(e) => setFirstName(e.target.value)} className="w-full border border-slate-500 rounded-lg px-3 py-2 text-sm" required />
        </div>
        <div>
          <label htmlFor="lastName" className="block text-xs font-semibold mb-1">Last name *</label>
          <input id="lastName" type="text" value={lastName} onChange={(e) => setLastName(e.target.value)} className="w-full border border-slate-500 rounded-lg px-3 py-2 text-sm" required />
        </div>
      </div>

      <div className="mt-4">
        <label htmlFor="email" className="block text-xs font-semibold mb-1">Email *</label>
        <input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-full border border-slate-500 rounded-lg px-3 py-2 text-sm" required />
      </div>

      <div className="mt-4">
        <label htmlFor="phone" className="block text-xs font-semibold mb-1">Phone (optional)</label>
        <input id="phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-full border border-slate-500 rounded-lg px-3 py-2 text-sm" placeholder="+1 (555) ..." />
      </div>

      <div className="mt-4">
        <label htmlFor="purpose" className="block text-xs font-semibold mb-1">Purpose</label>
        <textarea id="purpose" value={purpose} onChange={(e) => setPurpose(e.target.value)} className="w-full border border-slate-500 rounded-lg px-3 py-2 text-sm" rows={3} placeholder="Brand strategy intro, logo review, etc." />
      </div>

      {/* Turnstile widget — invisible challenge on booking form */}
      <div className="mt-4">
        {/* The challenge is invisible unless Cloudflare asks the visitor to act, so the
            container stays hidden. Left visible it rendered Cloudflare's own "Unable to
            connect to website / Troubleshoot" panel — vendor failure jargon as the first
            thing a visitor reads, saying the same thing as our own message in a second
            voice. `before-interactive-callback` reveals it if a real challenge appears. */}
        <div id="turnstile-widget" data-sitekey="0x4AAAAAAD8-3h6x-RUDasMf" className={needsInteraction ? '' : 'hidden'} />
        {challengeFailed && (
          <div className="p-3 rounded-xl border border-amber-200 bg-amber-50 text-xs text-amber-800" role="alert">
            We couldn't run the spam check — it may be blocked by your browser or network.{' '}
            <button type="button" onClick={() => { setChallengeFailed(false); resetTurnstile() }} className="underline font-semibold">
              Try again
            </button>
          </div>
        )}
        {/* Hidden input for token in tests */}
        <input type="hidden" value={turnstileToken} readOnly data-testid="turnstile-token" />
      </div>

      <button
        type="submit"
        disabled={loading || !turnstileToken}
        className="mt-6 w-full px-6 py-3 bg-black text-white rounded-full font-bold text-sm hover:bg-gray-800 disabled:opacity-50 disabled:cursor-not-allowed"
      >
        {loading ? 'Booking…' : 'Book this time'}
      </button>
      {!turnstileToken && !loading && !challengeFailed && (
        <p className="mt-2 text-xs text-gray-500 text-center">Just finishing a quick spam check…</p>
      )}

    </form>
  )
}
