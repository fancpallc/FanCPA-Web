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
  title: 'Jane Doe — Designer & Developer',
  meta_description: 'Portfolio of Jane Doe — branding, design, and development services',
  site_name: 'Jane Doe',
  footer_tagline: 'Strategic brand design and development for ambitious teams. Book a free intro call to start.',
  sort_order: 0,
  is_published: 1,
}

export const FALLBACK_SECTIONS: FallbackSection[] = [
  {
    id: 'sec_hero',
    page_id: 'page_home',
    type: 'hero',
    heading: 'Hi, I am Jane — Designer & Developer',
    subheading: 'Crafting brand identities and digital experiences that inspire',
    sort_order: 0,
    config: { theme: 'light', align: 'left' },
    is_visible: 1,
    items: [
      {
        id: 'item_hero_1',
        section_id: 'sec_hero',
        title: 'Welcome to My Portfolio',
        body: 'I help startups build memorable brands and intuitive digital products. Based in San Francisco, working globally.',
        image_url: 'https://images.unsplash.com/photo-1498050108023-c5249f4df085?w=1200&auto=format&fit=crop', image_alt: 'Designer at a desk working on a laptop',
        // Booking is the one destination that is always on the page, so the headline
        // button points there and says so.
        link_url: '/#calendar',
        link_text: 'Book a free call',
        sort_order: 0,
        is_visible: 1,
      },
    ],
  },
  {
    id: 'sec_services',
    page_id: 'page_home',
    type: 'cards-grid',
    heading: 'Branding & More Services',
    subheading: 'What I can do for you',
    sort_order: 1,
    config: { columns: 3 },
    is_visible: 0,
    items: [
      { id: 'item_svc_1', section_id: 'sec_services', title: 'Brand Strategy', body: 'Define your brand voice, positioning, and story', icon: '🎯', sort_order: 0, is_visible: 1 },
      { id: 'item_svc_2', section_id: 'sec_services', title: 'Logo Design', body: 'Memorable marks that stand the test of time', icon: '✨', sort_order: 1, is_visible: 1 },
      { id: 'item_svc_3', section_id: 'sec_services', title: 'Web Design', body: 'Clean, responsive websites that convert', icon: '💻', sort_order: 2, is_visible: 1 },
      { id: 'item_svc_4', section_id: 'sec_services', title: 'Illustration', body: 'Custom illustrations that tell your story', icon: '🎨', sort_order: 3, is_visible: 1 },
      { id: 'item_svc_5', section_id: 'sec_services', title: 'Art Direction', body: 'Creative direction for campaigns and launches', icon: '📸', sort_order: 4, is_visible: 1 },
      { id: 'item_svc_6', section_id: 'sec_services', title: 'Consulting', body: '1:1 sessions to level up your brand', icon: '💡', sort_order: 5, is_visible: 1 },
    ],
  },
  {
    id: 'sec_about',
    page_id: 'page_home',
    type: 'text-block',
    heading: 'About Me',
    subheading: 'Passion for design, 10 years experience',
    sort_order: 2,
    config: { image_position: 'left' },
    is_visible: 1,
    items: [
      {
        id: 'item_about_1',
        section_id: 'sec_about',
        title: 'Jane Doe',
        body: 'I’m a brand designer and front-end developer with 10+ years helping startups from idea to Series B. My approach blends strategic thinking with hands-on craft — from research and moodboards to final pixels and code. Previously at Figma, Airbnb. Now independent, working with select clients globally.',
        image_url: 'https://images.unsplash.com/photo-1494790108377-be9c29b29330?w=400&auto=format&fit=crop', image_alt: 'Portrait of Jane Doe, smiling',
        author: 'Senior Designer — 10 yrs — Figma, Airbnb, Independent',
        sort_order: 0,
        is_visible: 1,
      },
    ],
  },
  {
    id: 'sec_testimonials',
    page_id: 'page_home',
    type: 'testimonials',
    heading: 'Happy Clients Say',
    subheading: '',
    sort_order: 3,
    config: {},
    is_visible: 0,
    items: [
      { id: 'item_test_1', section_id: 'sec_testimonials', title: 'Startup Founder', body: 'Jane transformed our brand. The new identity helped us raise our seed round — investors immediately got who we are.', author: 'John Smith — CEO, BaseAI', rating: 5, sort_order: 0, is_visible: 1 },
      { id: 'item_test_2', section_id: 'sec_testimonials', title: 'Product Lead', body: 'Best collaboration ever. She shipped our entire design system in 3 weeks, with docs so good engineers loved it.', author: 'Alice Johnson — Product, Loom', rating: 5, sort_order: 1, is_visible: 1 },
      { id: 'item_test_3', section_id: 'sec_testimonials', title: 'Marketing Director', body: 'Our site conversion +40% after her redesign. Clean, fast, accessible — and still feels like us.', author: 'Mike Chen — Marketing, Linear', rating: 5, sort_order: 2, is_visible: 1 },
    ],
  },
  {
    id: 'sec_cta',
    page_id: 'page_home',
    type: 'cta-banner',
    heading: 'Ready to start your project?',
    subheading: 'Book a free 30-minute intro call — no pitch, just practical next steps.',
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
    heading: 'My Work — Selected Projects',
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
