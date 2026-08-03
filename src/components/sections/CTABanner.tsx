import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { isDeadAnchor } from '../../lib/anchors'

export interface CTABannerProps {
  section: Section
  items: SectionItem[]
  /** In-page anchors that exist on this render. Undefined means "not told" — show everything. */
  anchors?: Set<string>
}

export function CTABanner({ section, items, anchors }: CTABannerProps) {
  const first = items[0]
  const ctaDead = isDeadAnchor(first?.link_url, anchors)
  const ctaHref = ctaDead ? '#calendar' : first?.link_url
  const ctaText = ctaDead ? 'Book a free call' : first?.link_text || 'Book a free call'
  return (
    <section className="py-20 lg:py-24 bg-slate-900 text-white relative overflow-hidden">
      <div className="absolute inset-0 opacity-30" aria-hidden="true" style={{ background: 'radial-gradient(800px 400px at 20% 10%, #334155 0%, transparent 60%), radial-gradient(600px 300px at 80% 90%, #1e293b 0%, transparent 50%)' }}></div>
      <div className="max-w-5xl mx-auto px-6 text-center relative">
        {/* Heading, one supporting line, one button. This banner used to stack an
            availability pill, a heading and three supporting sentences — two of which
            both said "available for new projects" — under a button saying the same. */}
        {section.heading && <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>{section.heading}</h2>}
        {section.subheading && <p className="text-slate-300 mb-8 max-w-2xl mx-auto leading-relaxed">{section.subheading}</p>}
        <div className="flex gap-4 justify-center flex-wrap">
          {ctaHref && (
            <a href={ctaHref} className="inline-flex items-center gap-2 px-8 py-4 bg-white text-slate-900 rounded-full font-bold hover:bg-slate-100 shadow-lg focus:outline-none focus:ring-2 focus:ring-white focus:ring-offset-2 focus:ring-offset-slate-900 leading-none">
              {ctaText} <span aria-hidden>→</span>
            </a>
          )}
        </div>
      </div>
    </section>
  )
}
