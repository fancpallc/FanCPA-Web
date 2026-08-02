import React, { useState, useMemo, useEffect } from 'react'
import { useContent } from '../hooks/useContent'
import { HeroSection } from '../components/sections/HeroSection'
import { CardsGrid } from '../components/sections/CardsGrid'
import { TextBlock } from '../components/sections/TextBlock'
import { Testimonials } from '../components/sections/Testimonials'
import { CTABanner } from '../components/sections/CTABanner'
import { ImageGallery } from '../components/sections/ImageGallery'
import { CalendarView } from '../components/calendar/CalendarView'
import { SlotPicker } from '../components/calendar/SlotPicker'
import { BookingForm } from '../components/calendar/BookingForm'
import { ManageBookings } from '../components/calendar/ManageBookings'
import { useCalendar } from '../hooks/useCalendar'
import { generateIcsContent, downloadIcsFile } from '../lib/ics'
import type { Section } from '../lib/api'
import { debug } from '../lib/debug'
import { BOOKING_MESSAGES, isPlaceholderMeetLink } from '../lib/bookingMessages'

/** Which in-page anchor each section type provides, so nothing links to a section that isn't rendered. */
const ANCHOR_BY_TYPE: Record<string, string> = {
  'cards-grid': 'services',
  'text-block': 'about',
  testimonials: 'testimonials',
  'image-gallery': 'work',
}

function renderSection(section: Section, anchors: Set<string>) {
  const items = section.items || []
  switch (section.type) {
    case 'hero': return <HeroSection key={section.id} section={section} items={items} anchors={anchors} />
    // Each of these sections already carries its own anchor id — wrapping them in a
    // second element with the same id put two #about/#services nodes in the document.
    case 'cards-grid': return <CardsGrid key={section.id} section={section} items={items} />
    case 'text-block': return <TextBlock key={section.id} section={section} items={items} anchors={anchors} />
    case 'testimonials': return <Testimonials key={section.id} section={section} items={items} />
    case 'cta-banner': return <CTABanner key={section.id} section={section} items={items} anchors={anchors} />
    case 'image-gallery': return <ImageGallery key={section.id} section={section} items={items} />
    default: return null
  }
}

export function Home() {
  const { data, loading, error } = useContent('home')
  const { grouped, loading: calLoading, error: calError, slotMinutes, excludeToday, refetch: refetchCalendar, removeSlot } = useCalendar(2)
  const [selectedDate, setSelectedDate] = useState<string | null>(null)
  const [selectedSlot, setSelectedSlot] = useState<any>(null)
  const [bookingResult, setBookingResult] = useState<{ meetLink: string; dateTime: string; cancelUrl: string; source?: string; gcalError?: string; emailResult?: any; purpose?: string | null } | null>(null)

  const selectedSlots = useMemo(() => {
    if (!selectedDate) return []
    return grouped[selectedDate] || []
  }, [selectedDate, grouped])

  // Listen for cancellation from ManageBookings to refetch calendar (slot becomes free again)
  useEffect(() => {
    const handler = (e: any) => {
      debug(`!!! HOME_CANCEL_EVENT_RECEIVED bookingId=${e.detail?.bookingId} refetching calendar`)
      refetchCalendar()
      setTimeout(() => refetchCalendar(), 2000)
    }
    window.addEventListener('bookings-cancelled', handler as any)
    return () => window.removeEventListener('bookings-cancelled', handler as any)
  }, [refetchCalendar])

  if (loading) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-24 text-center">
        <div className="inline-block w-2 h-2 rounded-full bg-gray-400 animate-pulse mr-2"></div>
        <span className="text-gray-600">Loading portfolio…</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="max-w-5xl mx-auto px-6 py-24 text-center">
        <h1 className="text-2xl font-bold mb-3 tracking-tight">Unable to load portfolio</h1>
        <p className="text-gray-600 text-sm">Please try again later.</p>
      </div>
    )
  }

  const sections = data?.sections || []
  const anchors = new Set(['calendar', 'contact', ...sections.map((s) => ANCHOR_BY_TYPE[s.type]).filter(Boolean)])

  return (
    <div>
      {sections.length > 0 ? sections.map((s) => renderSection(s, anchors)) : (
        <div className="max-w-5xl mx-auto px-6 py-24 text-center">
          <h1 className="text-3xl font-black tracking-tight mb-3" style={{ fontFamily: 'Playfair Display, serif' }}>{data?.page?.title || 'Portfolio'}</h1>
          <p className="text-gray-600">Content is being prepared. Please check back soon.</p>
        </div>
      )}

      <section id="calendar" className="py-20 lg:py-24 bg-slate-50 border-t">
        <div className="max-w-5xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-10">
            <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>Book a meeting</h2>
            {/* The calendar itself states the slot length, timezone and booking window —
                repeating them here read as five copies of the same sentence. */}
            <p className="text-gray-600 leading-relaxed">Pick a time that works for you. No pitch, just practical next steps.</p>
          </div>

          {calLoading ? (
            <div className="max-w-md mx-auto text-center py-8">
              <div className="animate-pulse text-sm text-gray-500">Loading calendar…</div>
            </div>
          ) : calError ? (
            <div className="max-w-md mx-auto border border-red-200 bg-red-50 rounded-xl p-4 text-center text-sm text-red-700">
              Calendar unavailable
            </div>
          ) : (
            <div className="w-full">
              <CalendarView
                grouped={grouped}
                selectedDate={selectedDate}
                onDateSelect={(d) => {
                  setSelectedDate(d)
                  setSelectedSlot(null)
                  setBookingResult(null)
                  // The times open below the fold on a desktop viewport, which read as
                  // "clicking the day did nothing".
                  requestAnimationFrame(() =>
                    document.getElementById('slot-picker')?.scrollIntoView({ behavior: 'smooth', block: 'nearest' }),
                  )
                }}
                excludeToday={excludeToday}
                slotMinutes={slotMinutes}
              />
              {/* Full width, sharing the calendar card's edges — a narrower centred panel
                  left a step against the card above it. */}
              <div id="slot-picker" className="mt-8 w-full space-y-6">
                {selectedDate && !selectedSlot && !bookingResult && (
                  <SlotPicker date={selectedDate} slots={selectedSlots} onSlotSelect={(slot) => setSelectedSlot(slot)} onClose={() => { setSelectedDate(null); setSelectedSlot(null) }} slotMinutes={slotMinutes} />
                )}
                {!selectedDate && !bookingResult && (
                  <div className="text-center text-sm text-gray-500 py-4">
                    Select a day above to see its available times.
                  </div>
                )}
                {selectedSlot && !bookingResult && (
                  <BookingForm
                    slot={selectedSlot}
                    onSuccess={(result) => {
                      debug(`!!! HOME_BOOKING_SUCCESS slot=${selectedSlot.start} removing optimistic + refetching calendar with cache bust`)
                      // The visitor sees plain-English copy; the vendor's own wording is
                      // only useful to whoever has to fix the integration.
                      if (result.gcalError) debug(`!!! HOME_BOOKING_GCAL_ERROR ${result.gcalError}`)
                      if (result.emailResult && !result.emailResult.success) debug(`!!! HOME_BOOKING_EMAIL_ERROR ${result.emailResult.error}`)
                      setBookingResult(result)
                      // Optimistic removal so slot disappears immediately without reload
                      removeSlot(selectedSlot)
                      // Refetch with cache bust + short delay for Google FreeBusy propagation
                      refetchCalendar()
                      setTimeout(() => {
                        debug('!!! HOME_BOOKING_REFETCH_DELAYED for Google propagation')
                        refetchCalendar()
                      }, 2000)
                    }}
                    onCancel={() => { setSelectedSlot(null); }}
                  />
                )}
                {bookingResult && (
                  <div className="card rounded-2xl p-6 bg-green-50 border-green-300 text-center">
                    <h3 className="font-black text-xl mb-3">Meeting Confirmed ✅</h3>
                    <p className="text-sm mb-2">{bookingResult.dateTime}</p>
                    {bookingResult.purpose && <p className="text-sm mb-2">Purpose: <strong>{bookingResult.purpose}</strong></p>}
                    <p className="text-sm mb-2">Meet: <a href={bookingResult.meetLink} target="_blank" rel="noopener noreferrer" className="underline">{bookingResult.meetLink}</a></p>
                    {/* The vendor's own error string used to be printed here verbatim, so a
                        delivery failure showed the visitor Resend's developer documentation
                        and the calendar stub told them to check /api/debug/diag. The raw
                        text goes to the DEV console instead. */}
                    {isPlaceholderMeetLink(bookingResult.meetLink) && (
                      <div className="mx-auto max-w-md p-3 border border-amber-300 bg-amber-50 rounded-lg text-xs text-amber-800 mb-3 text-left">
                        <div className="font-semibold">{BOOKING_MESSAGES.placeholderMeetLink.heading}</div>
                        <div>{BOOKING_MESSAGES.placeholderMeetLink.detail}</div>
                      </div>
                    )}
                    {bookingResult.emailResult && !bookingResult.emailResult.success && (
                      <div className="mx-auto max-w-md p-3 border border-orange-300 bg-orange-50 rounded-lg text-xs text-orange-800 mb-3 text-left">
                        <div className="font-semibold">{BOOKING_MESSAGES.emailNotSent.heading}</div>
                        <div>{BOOKING_MESSAGES.emailNotSent.detail}</div>
                      </div>
                    )}
                    {/* Saying nothing when the email did go out leaves the visitor
                        wondering whether to expect one. */}
                    {bookingResult.emailResult?.success && bookingResult.emailResult.source === 'live' && (
                      <p className="text-xs text-green-800 mb-3">A confirmation email is on its way.</p>
                    )}
                    <div className="flex gap-3 justify-center flex-wrap">
                      <button onClick={() => { const ics = generateIcsContent({ title: `Meeting — ${bookingResult.dateTime}`, description: `Meet: ${bookingResult.meetLink}\nCancel: ${bookingResult.cancelUrl}`, location: bookingResult.meetLink, start: selectedSlot?.start || new Date().toISOString(), end: selectedSlot?.end || new Date().toISOString(), meetLink: bookingResult.meetLink }); downloadIcsFile(ics, `meeting-${selectedDate}.ics`); }} className="px-6 py-3 bg-slate-900 text-white rounded-full text-sm font-semibold hover:bg-black leading-none">
                        Download invite (.ics)
                      </button>
                      <a href={bookingResult.cancelUrl} className="px-6 py-3 rounded-full border border-red-600 bg-white text-red-700 text-sm font-semibold hover:bg-red-50 leading-none inline-flex items-center justify-center">
                        Cancel meeting
                      </a>
                    </div>
                    <div className="flex gap-3 justify-center flex-wrap mt-4">
                      <button onClick={() => { debug('!!! HOME_BOOK_ANOTHER clear + refetch'); setSelectedDate(null); setSelectedSlot(null); setBookingResult(null); refetchCalendar(); }} className="px-6 py-3 bg-black text-white rounded-full text-sm font-semibold leading-none">Book another</button>
                      <a href={bookingResult.meetLink} target="_blank" rel="noopener noreferrer" className="px-6 py-3 bg-white border border-slate-500 rounded-full text-sm font-semibold leading-none inline-flex items-center justify-center">Open Meet →</a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          )}
        </div>
      </section>

      <ManageBookings />
    </div>
  )
}
