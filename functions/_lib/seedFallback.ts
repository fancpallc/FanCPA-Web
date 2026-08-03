/**
 * The content `/api/content/home` serves when D1 has no tables yet.
 *
 * This used to be a literal inlined in the route handler, and it drifted: it still
 * advertised a hero button reading "Explore Services" pointing at `/#services` long
 * after the seed had changed that button to "Book a free call" and migration 0004 had
 * hidden the services section outright. Anyone hitting the fallback saw a headline
 * button whose label named a section that was not on the page.
 *
 * Keep this in step with `migrations/0002_seed.sql` and `migrations/0004_hide_extra_sections.sql`.
 * `seedFallback.test.ts` checks the invariants that actually broke.
 */

export interface FallbackItem {
  id: string
  section_id: string
  title?: string | null
  body?: string | null
  image_url?: string | null
  image_alt?: string | null
  icon?: string | null
  link_url?: string | null
  link_text?: string | null
  author?: string | null
  rating?: number | null
  sort_order: number
  is_visible: number
}

export interface FallbackSection {
  id: string
  page_id: string
  type: string
  heading?: string | null
  subheading?: string | null
  sort_order: number
  config: Record<string, unknown>
  is_visible: number
  items: FallbackItem[]
}

export const FALLBACK_PAGE = {
  id: 'page_home',
  slug: 'home',
  title: 'FanCPA — Professional Accounting & Tax Services',
  meta_description: 'Comprehensive tax, bookkeeping, and advisory services for businesses and individuals.',
  site_name: 'FAN CPA LLC',
  footer_tagline: 'Strategic financial services for businesses. Book a free intro call to start.',
  sort_order: 0,
  is_published: 1,
}

export const FALLBACK_SECTIONS: FallbackSection[] = [
  {
    id: 'sec_hero',
    page_id: 'page_home',
    type: 'hero',
    heading: 'Empowering Your Financial Success',
    subheading: 'Expert tax strategy, precise bookkeeping, and personalized financial guidance to help your business thrive.',
    sort_order: 0,
    config: { theme: 'light', align: 'left' },
    is_visible: 1,
    items: [
      {
        id: 'item_hero_1',
        section_id: 'sec_hero',
        title: 'Your Partner in Accounting',
        body: 'Professional financial services designed to save you time and maximize your returns. We handle the numbers, so you can focus on your business.',
        image_url: 'https://images.unsplash.com/photo-1554224155-8d04cb27cd6c?w=1200&auto=format&fit=crop', image_alt: 'Professional accountant',
        // Booking is the one destination that is always on the page, so the headline
        // button points there and says so.
        link_url: '/#calendar',
        link_text: 'Schedule a meeting',
        sort_order: 0,
        is_visible: 1,
      },
    ],
  },
  {
    id: 'sec_services',
    page_id: 'page_home',
    type: 'cards-grid',
    heading: 'Our Services',
    subheading: 'Tailored solutions to manage your finances',
    sort_order: 1,
    config: { columns: 3 },
    is_visible: 0,
    items: [
      { id: 'item_svc_1', section_id: 'sec_services', title: 'Tax Preparation', body: 'Expert preparation for individuals and business filings', icon: '📋', sort_order: 0, is_visible: 1 },
      { id: 'item_svc_2', section_id: 'sec_services', title: 'Bookkeeping', body: 'Clean, organized financial records you can trust', icon: '📈', sort_order: 1, is_visible: 1 },
      { id: 'item_svc_3', section_id: 'sec_services', title: 'Payroll Services', body: 'Stress-free payroll management and compliance', icon: '💳', sort_order: 2, is_visible: 1 },
      { id: 'item_svc_4', section_id: 'sec_services', title: 'Financial Planning', body: 'Strategic advice for long-term growth', icon: '📊', sort_order: 3, is_visible: 1 },
      { id: 'item_svc_5', section_id: 'sec_services', title: 'CFO Services', body: 'High-level financial strategy on demand', icon: '👔', sort_order: 4, is_visible: 1 },
      { id: 'item_svc_6', section_id: 'sec_services', title: 'Business Consulting', body: 'Guidance to scale your business operations', icon: '🚀', sort_order: 5, is_visible: 1 },
    ],
  },
  {
    id: 'sec_about',
    page_id: 'page_home',
    type: 'text-block',
    heading: 'About FanCPA',
    subheading: 'Years of experience in navigating complex financial landscapes.',
    sort_order: 2,
    config: { image_position: 'left' },
    is_visible: 1,
    items: [
      {
        id: 'item_about_1',
        section_id: 'sec_about',
        title: 'The FanCPA Advantage',
        body: 'With over 15 years of experience, we provide more than just number-crunching. We act as an extension of your team, providing actionable financial insights to help you make informed decisions.',
        image_url: 'https://images.unsplash.com/photo-1560520653-9e0e4c89eb11?w=400&auto=format&fit=crop', image_alt: 'Professional accountant',
        author: 'FanCPA Team',
        sort_order: 0,
        is_visible: 1,
      },
    ],
  },
  {
    id: 'sec_testimonials',
    page_id: 'page_home',
    type: 'testimonials',
    heading: 'Trusted by Our Clients',
    subheading: '',
    sort_order: 3,
    config: {},
    is_visible: 0,
    items: [
      { id: 'item_test_1', section_id: 'sec_testimonials', title: 'Small Business Owner', body: 'FanCPA has been a lifesaver. Tax season is no longer stressful, and their bookkeeping advice saved us thousands.', author: 'Alex R. — Founder', rating: 5, sort_order: 0, is_visible: 1 },
      { id: 'item_test_2', section_id: 'sec_testimonials', title: 'Entrepreneur', body: 'Their CFO services were exactly what I needed to scale my operations. Strategic, professional, and reliable.', author: 'Sarah L. — CEO', rating: 5, sort_order: 1, is_visible: 1 },
      { id: 'item_test_3', section_id: 'sec_testimonials', title: 'Professional', body: 'I’ve been with FanCPA for 5 years now. They make complex financial decisions simple and clear.', author: 'David K. — Consultant', rating: 5, sort_order: 2, is_visible: 1 },
    ],
  },
  {
    id: 'sec_cta',
    page_id: 'page_home',
    type: 'cta-banner',
    heading: 'Ready to simplify your finances?',
    subheading: 'Book a free 30-minute consultation to discuss your needs.',
    sort_order: 4,
    config: {},
    is_visible: 0,
    // title and body are deliberately null: the banner already carries a heading and a
    // subheading, and filling these in stacked four near-identical lines of filler.
    items: [{ id: 'item_cta_1', section_id: 'sec_cta', title: null, body: null, link_url: '/#calendar', link_text: 'Book a free call', sort_order: 0, is_visible: 1 }],
  },
  {
    id: 'sec_gallery',
    page_id: 'page_home',
    type: 'image-gallery',
    heading: 'Our Workspace',
    subheading: '',
    sort_order: 5,
    config: { columns: 3 },
    is_visible: 0,
    items: [
      { id: 'item_gal_1', section_id: 'sec_gallery', title: 'BaseAI Brand', body: 'AI startup identity', image_url: 'https://images.unsplash.com/photo-1551288049-bebda4e38f71?w=600&auto=format&fit=crop', image_alt: 'Analytics dashboard screens from the BaseAI brand identity', sort_order: 0, is_visible: 1 },
      { id: 'item_gal_2', section_id: 'sec_gallery', title: 'Loom Design System', body: 'Component library + tokens', image_url: 'https://images.unsplash.com/photo-1558655146-d09347e92766?w=600&auto=format&fit=crop', image_alt: 'Loom design system components laid out on a monitor', sort_order: 1, is_visible: 1 },
      { id: 'item_gal_3', section_id: 'sec_gallery', title: 'Linear Redesign', body: 'Marketing site + app', image_url: 'https://images.unsplash.com/photo-1460925895917-afdab827c52f?w=600&auto=format&fit=crop', image_alt: 'The redesigned Linear marketing site on a desktop screen', sort_order: 2, is_visible: 1 },
      { id: 'item_gal_4', section_id: 'sec_gallery', title: 'Figma Workshops', body: 'Team training materials', image_url: 'https://images.unsplash.com/photo-1517245386807-bb43f82c33c4?w=600&auto=format&fit=crop', image_alt: 'Workshop attendees sketching at a shared table', sort_order: 3, is_visible: 1 },
      { id: 'item_gal_5', section_id: 'sec_gallery', title: 'Onboarding Illustrations', body: 'Custom set for SaaS', image_url: 'https://images.unsplash.com/photo-1516321318423-f06f85e504b3?w=600&auto=format&fit=crop', image_alt: 'Onboarding illustrations open on a laptop', sort_order: 4, is_visible: 1 },
      { id: 'item_gal_6', section_id: 'sec_gallery', title: 'Brand Guidelines', body: '150-page guidebook', image_url: 'https://images.unsplash.com/photo-1586717791821-3f44a563fa4c?w=600&auto=format&fit=crop', image_alt: 'A printed brand guidelines book held open on a tablet', sort_order: 5, is_visible: 1 },
    ],
  },
]

/**
 * What the public route returns. The DB path filters hidden sections and items before
 * responding; the fallback has to do the same, or hitting it would publish four sections
 * that migration 0004 took down.
 */
export function publicSeedFallback() {
  return {
    page: FALLBACK_PAGE,
    sections: FALLBACK_SECTIONS.filter((s) => s.is_visible === 1)
      .slice()
      .sort((a, b) => a.sort_order - b.sort_order)
      .map((s) => ({
        ...s,
        items: s.items
          .filter((i) => i.is_visible === 1)
          .slice()
          .sort((a, b) => a.sort_order - b.sort_order),
      })),
  }
}

/** In-page anchors the fallback actually renders, so a CTA cannot name a missing one. */
export function fallbackAnchors(): Set<string> {
  const anchorByType: Record<string, string> = { 'cards-grid': 'services', 'text-block': 'about', testimonials: 'testimonials' }
  const anchors = new Set<string>(['calendar'])
  for (const s of FALLBACK_SECTIONS) {
    if (s.is_visible === 1 && anchorByType[s.type]) anchors.add(anchorByType[s.type])
  }
  return anchors
}

