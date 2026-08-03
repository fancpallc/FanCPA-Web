import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { SafeImage } from '../common/SafeImage'

export interface TextBlockProps {
  section: Section
  items: SectionItem[]
  /** In-page anchors that exist on this render. Undefined means "not told" — show everything. */
  anchors?: Set<string>
}

export function TextBlock({ section, items, anchors }: TextBlockProps) {
  const first = items[0]
  return (
    <section className="py-20 lg:py-24 bg-slate-50" id="about">
      <div className="max-w-5xl mx-auto px-6 flex flex-col lg:flex-row gap-12 lg:gap-16 items-center">
        <div className="flex-1 w-full">
          <div className="relative">
            {first?.image_url ? (
              <SafeImage src={first.image_url} alt={first.image_alt || first.title || 'About portrait'} className="w-full rounded-2xl object-cover shadow-md aspect-[4/3] h-auto" loading="lazy" decoding="async" />
            ) : (
              <div className="w-full aspect-[4/3] bg-white border rounded-2xl flex items-center justify-center text-gray-400">Portrait</div>
            )}
          </div>
        </div>
        <div className="flex-1 w-full max-w-[65ch]">
          {section.heading && <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>{section.heading}</h2>}
          {section.subheading && <p className="text-lg text-gray-600 mb-6 leading-relaxed">{section.subheading}</p>}
          {first?.title && <h3 className="text-xl font-bold mb-4">{first.title}</h3>}
          {first?.body && <div className="text-gray-700 leading-relaxed whitespace-pre-wrap mb-6">{first.body}</div>}
          {first?.author && (
            <div className="mt-2 p-4 bg-white border border-slate-200 rounded-xl text-sm">
              <div className="font-semibold mb-1">Credentials & Experience</div>
              <div className="text-gray-600">{first.author}</div>
            </div>
          )}
          <div className="mt-8 flex gap-3">
            <a href="#calendar" className="btn-primary text-sm">Book a free call</a>
          </div>
        </div>
      </div>
    </section>
  )
}
