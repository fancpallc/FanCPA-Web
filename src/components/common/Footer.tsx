import React from 'react'
import { useContent } from '../../hooks/useContent'

export function Footer() {
  // Same source as the nav: only link to sections that are actually on the page.
  // The footer used to advertise Services/About/Testimonials unconditionally, so
  // hiding a section left a link that scrolled nowhere.
  const { data } = useContent('home')
  const sections = data?.sections || []
  // Owner-editable via the "Your site" card in /admin. These were literals, so the
  // brand and the copyright line named "Portfolio" on somebody else's website.
  const siteName = data?.page?.site_name?.trim() || 'Portfolio'
  const tagline = data?.page?.footer_tagline?.trim() || 'Book a free intro call to get started.'
  const has = (type: string) => sections.some((s: any) => s.type === type)
  const services = (sections.find((s: any) => s.type === 'cards-grid')?.items || [])
    .map((i: any) => i.title)
    .filter(Boolean)

  const companyLinks = [
    { label: 'About', href: '#about', show: has('text-block') },
    { label: 'Work', href: '#work', show: has('image-gallery') },
    { label: 'Testimonials', href: '#testimonials', show: has('testimonials') },
  ].filter((l) => l.show)

  return (
    <footer id="contact" className="border-t bg-white">
      <div className="max-w-5xl mx-auto px-6 py-12">
        <div className="flex flex-col lg:flex-row justify-between gap-10 text-sm">
          <div className="max-w-sm">
            <div className="font-black text-2xl tracking-tight mb-3" style={{ fontFamily: 'Playfair Display, serif' }}>{siteName}</div>
            <p className="text-gray-600 leading-relaxed">{tagline}</p>
          </div>
          {services.length > 0 && (
            <div>
              <div className="font-bold mb-4 tracking-tight">Services</div>
              <div className="flex flex-col gap-2 text-gray-600">
                {services.map((label: string) => (
                  <a key={label} href="#services" className="hover:text-black inline-flex items-center min-h-11">{label}</a>
                ))}
              </div>
            </div>
          )}
          {companyLinks.length > 0 && (
            <div>
              <div className="font-bold mb-4 tracking-tight">More</div>
              <div className="flex flex-col gap-2 text-gray-600">
                {companyLinks.map((l) => (
                  <a key={l.href} href={l.href} className="hover:text-black inline-flex items-center min-h-11">{l.label}</a>
                ))}
              </div>
            </div>
          )}
          <div className="bg-slate-50 border rounded-xl p-5 h-fit">
            <div className="font-bold mb-2">Get in touch</div>
            <p className="text-gray-600 text-xs mb-4 max-w-[22ch]">Book a 30-min call. No pitch, just practical next steps.</p>
            <a href="#calendar" className="btn-primary text-sm w-full justify-center">Book a free call →</a>
          </div>
        </div>
        <div className="border-t mt-10 pt-6 flex flex-col sm:flex-row justify-between gap-3 text-xs text-gray-500">
          <div>© {new Date().getFullYear()} {siteName}. All rights reserved.</div>
          <div>Remote-first</div>
        </div>
      </div>
    </footer>
  )
}
