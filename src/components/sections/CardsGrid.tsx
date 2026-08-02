import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { SafeImage } from '../common/SafeImage'

/**
 * Used only when a card has no icon of its own. Deliberately excludes '◈', which most
 * system fonts do not carry and which rendered as a missing-character box.
 */
const FALLBACK_ICONS = ['✦', '✧', '◎', '◐', '✶', '❖']

export interface CardsGridProps {
  section: Section
  items: SectionItem[]
}

export function CardsGrid({ section, items }: CardsGridProps) {
  return (
    <section className="py-20 lg:py-24 bg-white" id="services">
      <div className="max-w-5xl mx-auto px-6">
        <div className="max-w-2xl mx-auto text-center mb-12">
          {section.heading && <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>{section.heading}</h2>}
          {section.subheading && <p className="text-gray-600 leading-relaxed">{section.subheading}</p>}
        </div>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
          {items.map((item, idx) => (
            // The icon comes before the image, not after it. With the image first, a card
            // that had one pushed its icon ~200px down while its image-less row-mates kept
            // theirs at the top, and the row of icons visibly failed to line up.
            <div key={item.id} className="card p-8 flex flex-col">
              <div className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-200 flex items-center justify-center flex-none mb-5">
                <span aria-hidden="true" style={{ fontSize: '22px', lineHeight: 1 }}>{item.icon || FALLBACK_ICONS[idx % FALLBACK_ICONS.length]}</span>
              </div>
              {/* The admin offers an uploader on every card, so the card has to show the
                  result — six "Uploaded ✓" ticks used to change nothing on the live page. */}
              {item.image_url && (
                <SafeImage src={item.image_url} alt={item.image_alt || (item.title ? `${item.title} service` : 'Service illustration')} className="w-full rounded-xl object-cover aspect-video mb-5" loading="lazy" decoding="async" />
              )}
              {item.title && <h3 className="font-bold text-[17px] mb-2 tracking-tight">{item.title}</h3>}
              {item.body && <p className="text-gray-600 text-sm leading-relaxed">{item.body}</p>}
            </div>
          ))}
        </div>
        {items.length === 0 && <div className="text-center text-gray-400 py-8">Services coming soon</div>}
      </div>
    </section>
  )
}
