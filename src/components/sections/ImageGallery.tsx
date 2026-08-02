import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { SafeImage } from '../common/SafeImage'

export interface ImageGalleryProps {
  section: Section
  items: SectionItem[]
}

export function ImageGallery({ section, items }: ImageGalleryProps) {
  return (
    // lg:py-24 like every other content section — the gallery alone stayed at 80px on
    // desktop, which broke the page's vertical rhythm and the admin preview's parity.
    <section className="py-20 lg:py-24 bg-slate-50" id="work">
      <div className="max-w-5xl mx-auto px-6">
        <div className="max-w-2xl mx-auto text-center mb-10">
          {section.heading && <h2 className="text-3xl lg:text-4xl font-black tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>{section.heading}</h2>}
          {section.subheading && <p className="text-gray-600 mt-3">{section.subheading}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {items.map((item) => (
            // No hover zoom: the transform promised a lightbox that does not exist, so
            // the tile invited a click that did nothing. A still tile promises nothing.
            <div key={item.id} className="card overflow-hidden bg-white">
              <div className="overflow-hidden aspect-[4/3] bg-white">
                {item.image_url ? (
                  <SafeImage src={item.image_url} alt={item.image_alt || (item.title ? `${item.title} – project` : 'Selected work')} className="w-full h-full object-cover" loading="lazy" decoding="async" />
                ) : (
                  <div className="w-full h-full bg-slate-100 flex items-center justify-center text-gray-400">Work</div>
                )}
              </div>
              {(item.title || item.body) && (
                <div className="p-5">
                  {item.title && <div className="font-bold text-sm mb-1 tracking-tight">{item.title}</div>}
                  {item.body && <div className="text-xs text-gray-600 leading-relaxed">{item.body}</div>}
                </div>
              )}
            </div>
          ))}
        </div>
        {items.length === 0 && <div className="text-center text-gray-400 py-8">Selected work coming soon</div>}
      </div>
    </section>
  )
}
