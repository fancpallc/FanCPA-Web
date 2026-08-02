import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { isDeadAnchor } from '../../lib/anchors'
import { SafeImage } from '../common/SafeImage'

export interface HeroSectionProps {
  section: Section
  items: SectionItem[]
  /** In-page anchors that exist on this render. Undefined means "not told" — show everything. */
  anchors?: Set<string>
}

export function HeroSection({ section, items, anchors }: HeroSectionProps) {
  const first = items[0]
  // Never leave the page's primary button dead: if its configured target has been
  // hidden, fall back to booking, which is always on the page.
  const ctaDead = isDeadAnchor(first?.link_url, anchors)
  const ctaHref = ctaDead ? '#calendar' : first?.link_url
  const ctaText = ctaDead ? 'Book a free call' : first?.link_text || 'Book a free call'
  return (
    <section className="hero py-20 lg:py-24">
      <div className="max-w-5xl mx-auto px-6 flex flex-col lg:flex-row gap-12 lg:gap-16 items-center relative">
        <div className="flex-1 w-full">
          <div className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-gray-500 mb-5">
            <span className="w-2 h-2 rounded-full bg-green-500 inline-block"></span>
            Available for new projects
          </div>
          <h1 className="text-4xl lg:text-5xl font-black mb-5 tracking-tight leading-tight" style={{ fontFamily: 'Playfair Display, serif' }}>
            {section.heading || 'Strategic branding that drives growth'}
          </h1>
          {section.subheading && <p className="text-xl text-gray-600 mb-6 leading-relaxed max-w-[60ch]">{section.subheading}</p>}
          {first?.body && <p className="text-gray-600 mb-8 leading-relaxed max-w-[60ch]">{first.body}</p>}
          <div className="flex gap-3 flex-wrap items-center">
            {ctaHref && (
              <a href={ctaHref} className="btn-primary">
                {ctaText} <span aria-hidden>→</span>
              </a>
            )}
          </div>
        </div>
        <div className="flex-1 w-full">
          {first?.image_url ? (
            <div className="relative">
              <div className="absolute -inset-3 bg-slate-50 rounded-2xl -z-10 rotate-1"></div>
              <SafeImage src={first.image_url} alt={first.image_alt || 'Portrait of the site owner'} className="w-full rounded-2xl shadow-lg object-cover aspect-[4/3] h-auto" loading="lazy" decoding="async" />
            </div>
          ) : (
            <div className="w-full aspect-[4/3] bg-slate-50 border rounded-2xl flex items-center justify-center text-gray-400">Illustration</div>
          )}
        </div>
      </div>
    </section>
  )
}
