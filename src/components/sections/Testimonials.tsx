import React from 'react'
import type { Section, SectionItem } from '../../lib/api'
import { StarRating } from '../common/StarRating'

export interface TestimonialsProps {
  section: Section
  items: SectionItem[]
}

export function Testimonials({ section, items }: TestimonialsProps) {
  return (
    <section className="py-20 lg:py-24 bg-white" id="testimonials">
      <div className="max-w-5xl mx-auto px-6">
        <div className="max-w-2xl mx-auto text-center mb-12">
          {section.heading && <h2 className="text-3xl lg:text-4xl font-black tracking-tight" style={{ fontFamily: 'Playfair Display, serif' }}>{section.heading}</h2>}
          {section.subheading && <p className="text-gray-600 mt-4">{section.subheading}</p>}
        </div>
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {items.map((item) => (
            <div key={item.id} className="card p-6 bg-slate-50 border-slate-200 flex flex-col">
              <StarRating rating={item.rating} className="mb-3" />
              {item.body && <p className="text-gray-800 leading-relaxed mb-5">"{item.body}"</p>}
              <div className="flex items-center gap-3 mt-auto">
                <div className="w-9 h-9 rounded-full bg-slate-900 text-white flex items-center justify-center text-xs font-bold flex-none">
                  {item.author?.trim()?.[0] || '•'}
                </div>
                <div>
                  {item.author && <div className="font-semibold text-sm leading-tight">{item.author}</div>}
                  {item.title && <div className="text-xs text-gray-500">{item.title}</div>}
                </div>
              </div>
            </div>
          ))}
        </div>
        {items.length === 0 && <div className="text-center text-gray-400 py-8">Client feedback coming soon</div>}
      </div>
    </section>
  )
}
