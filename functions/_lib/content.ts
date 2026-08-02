export interface Page {
  id: string
  slug: string
  title: string
  meta_description?: string | null
  sort_order: number
  is_published: number
  updated_at?: string
}

export interface Section {
  id: string
  page_id: string
  type: 'hero' | 'cards-grid' | 'testimonials' | 'text-block' | 'cta-banner' | 'image-gallery'
  heading?: string | null
  subheading?: string | null
  sort_order: number
  config: any
  is_visible: number
  updated_at?: string
  items?: SectionItem[]
}

export interface SectionItem {
  id: string
  section_id: string
  title?: string | null
  body?: string | null
  image_url?: string | null
  icon?: string | null
  link_url?: string | null
  link_text?: string | null
  author?: string | null
  sort_order: number
  is_visible: number
  updated_at?: string
}

export function safeParseConfig(raw: any): any {
  if (!raw) return {}
  if (typeof raw === 'object') return raw
  try {
    const parsed = JSON.parse(String(raw))
    if (typeof parsed === 'object' && parsed !== null) return parsed
    return {}
  } catch {
    return {}
  }
}

export function orderBySort<T extends { sort_order?: number | null }>(arr: T[] | null | undefined): T[] {
  if (!arr || !Array.isArray(arr)) return []
  return [...arr].sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0))
}

export function filterVisible<T extends { is_visible?: number | null }>(arr: T[] | null | undefined): T[] {
  if (!arr || !Array.isArray(arr)) return []
  return arr.filter((i) => (i.is_visible ?? 1) === 1)
}
