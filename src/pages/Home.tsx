import React, { useState, useMemo, useEffect } from 'react'
import { useContent } from '../hooks/useContent'
import { HeroSection } from '../components/sections/HeroSection'
import { CardsGrid } from '../components/sections/CardsGrid'
import { TextBlock } from '../components/sections/TextBlock'
import { Testimonials } from '../components/sections/Testimonials'
import { CTABanner } from '../components/sections/CTABanner'
import { ImageGallery } from '../components/sections/ImageGallery'
import { COMMON_TIMEZONES } from '../lib/timezones'
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
  const [timeZone, setTimeZone] = useState(Intl.DateTimeFormat().resolvedOptions().timeZone)

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

      {/* Adding a bottom margin to align spacing with previous section if needed,
          using same py-20 lg:py-24 pattern found in section rendering */}
      <section id="calendar" className="py-20 lg:py-24 bg-slate-50 border-t">
        <div className="max-w-5xl mx-auto px-6">
          <div className="max-w-3xl mx-auto text-center mb-16">
            <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>Book a meeting</h2>
            <p className="text-gray-600 leading-relaxed text-lg">Pick a time that works for you. No pitch, just practical next steps.</p>
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
                timeZone={timeZone}
                setTimeZone={setTimeZone}
                onDateSelect={(d) => {
                  setSelectedDate(d)
                  setSelectedSlot(null)
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
                {selectedDate && !selectedSlot && (
                  <SlotPicker 
                    date={selectedDate} 
                    slots={selectedSlots} 
                    onSlotSelect={(slot) => setSelectedSlot(slot)} 
                    onClose={() => { setSelectedDate(null); setSelectedSlot(null) }} 
                    slotMinutes={slotMinutes} 
                    timeZone={timeZone} 
                    setTimeZone={setTimeZone}
                  />
                )}
                {!selectedDate && (
                  <div className="text-center text-sm text-gray-500 py-4">
                    Select a day above to see its available times.
                  </div>
                )}
                {selectedSlot && (
                  <BookingForm
                    slot={selectedSlot}
                    timeZone={timeZone}
                    onSuccess={(result) => {
                      debug(`!!! HOME_BOOKING_SUCCESS slot=${selectedSlot.start} removing optimistic + refetching calendar with cache bust`)
                      if (result.gcalError) debug(`!!! HOME_BOOKING_GCAL_ERROR ${result.gcalError}`)
                      if (result.emailResult && !result.emailResult.success) debug(`!!! HOME_BOOKING_EMAIL_ERROR ${result.emailResult.error}`)
                      // Pending path is rendered entirely inside BookingForm (Booking Requested + spam line).
                      // This callback now only handles optimistic slot removal; no bookingResult state (dead amber panel removed).
                      removeSlot(selectedSlot)
                      refetchCalendar()
                      setTimeout(() => {
                        debug('!!! HOME_BOOKING_REFETCH_DELAYED for Google propagation')
                        refetchCalendar()
                      }, 2000)
                    }}
                    onCancel={() => { setSelectedSlot(null); }}
                  />
                )}
              </div>
            </div>
          )}
        </div>
      </section>
    </div>
  )
}

