import React, { useEffect, useRef, useState } from 'react'
import { useContent } from '../../hooks/useContent'

export interface NavProps {
  title?: string
}

export function Nav({ title = 'Portfolio' }: NavProps) {
  const { data } = useContent('home')
  const visibleTypes = new Set((data?.sections || []).map((s: any) => s.type))
  const [menuOpen, setMenuOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)

  // Build nav items based on visible sections + always calendar and contact
  // "Contact" used to point at the footer, which on a short page cannot scroll to the
  // top of the viewport — visitors landed mid-way through the booking-lookup form
  // instead. Booking is the contact route, so it is named as such and listed once.
  const navItems: { label: string; href: string; show: boolean }[] = [
    { label: 'Services', href: '#services', show: visibleTypes.has('cards-grid') },
    { label: 'About', href: '#about', show: visibleTypes.has('text-block') },
    { label: 'Testimonials', href: '#testimonials', show: visibleTypes.has('testimonials') },
    // The gallery is often the largest section on the page and nothing used to link to it.
    { label: 'Work', href: '#work', show: visibleTypes.has('image-gallery') },
  ]

  const sectionLinks = navItems.filter((it) => it.show)
  // One link fits next to the wordmark on a phone; hiding a single "About" behind a
  // hamburger costs a tap and tells the visitor nothing about what is in there.
  const collapseOnMobile = sectionLinks.length > 1

  useEffect(() => {
    if (!menuOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMenuOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) setMenuOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [menuOpen])

  return (
    // <header> is the banner and <nav> is the navigation. These roles used to be
    // inverted — role="banner" on the <nav>, with a role="navigation" div inside it.
    <header className="border-b bg-white sticky top-0 z-10">
      <nav className="max-w-5xl mx-auto px-6 py-4 flex justify-between items-center gap-4" aria-label="Main navigation">
        <div className="font-black text-xl tracking-tight flex-none" style={{ fontFamily: 'Playfair Display, serif' }}>{title}</div>
        {/* One row at every width. Below 640px the section links wrapped under the
            wordmark and the sticky bar grew to 137px — 16% of a phone screen — so on a
            phone they collapse behind a Menu button instead of disappearing entirely. */}
        <div className="flex items-center gap-4 sm:gap-6 text-sm font-semibold justify-end">
          {sectionLinks.map((item) => (
            <a key={item.href} href={item.href} className={`${collapseOnMobile ? 'hidden sm:inline-flex' : 'inline-flex'} hover:underline focus:outline-none focus:underline items-center min-h-11 px-1`}>
              {item.label}
            </a>
          ))}
          <a href="#calendar" className="inline-flex items-center min-h-11 px-4 rounded-full bg-slate-900 text-white whitespace-nowrap">
            Book a free call
          </a>
          {collapseOnMobile && (
            <div className="relative sm:hidden" ref={menuRef}>
              <button
                type="button"
                onClick={() => setMenuOpen((v) => !v)}
                aria-expanded={menuOpen}
                aria-label={menuOpen ? 'Close menu' : 'Open menu'}
                className="inline-flex items-center justify-center min-h-11 w-11 rounded-full border border-slate-500 bg-white hover:border-slate-900"
              >
                <span aria-hidden className="text-base leading-none">{menuOpen ? '✕' : '☰'}</span>
              </button>
              {menuOpen && (
                <div className="absolute right-0 top-full mt-2 w-44 rounded-xl border border-slate-200 bg-white shadow-lg p-2 flex flex-col">
                  {sectionLinks.map((item) => (
                    <a
                      key={item.href}
                      href={item.href}
                      onClick={() => setMenuOpen(false)}
                      className="inline-flex items-center min-h-11 px-3 rounded-lg hover:bg-slate-50"
                    >
                      {item.label}
                    </a>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>
      </nav>
    </header>
  )
}
