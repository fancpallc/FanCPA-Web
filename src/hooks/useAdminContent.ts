import { useEffect, useState, useCallback } from 'react'
import { fetchJson } from '../lib/api'
import { debug } from '../lib/debug'

export interface AdminSection {
  id: string
  type: string
  heading: string
  subheading?: string
  sort_order: number
  is_visible: number
  config: any
  items: AdminItem[]
}

export interface AdminItem {
  id: string
  section_id: string
  title: string
  body?: string
  image_url?: string
  sort_order: number
  is_visible: number
  icon?: string
  link_url?: string
  link_text?: string
  author?: string
  /** Testimonials only. NULL means "never set" and renders as 5. */
  rating?: number | null
  /** Owner-written description of image_url, for screen readers. */
  image_alt?: string | null
}

export interface AdminPage {
  id: string
  slug: string
  title: string
  meta_description?: string | null
  site_name?: string | null
  footer_tagline?: string | null
}

export interface UseAdminContentReturn {
  sections: AdminSection[]
  page: AdminPage | null
  loading: boolean
  error: string | null
  updateSection: (id: string, patch: Partial<AdminSection>) => Promise<void>
  updateItem: (id: string, patch: Partial<AdminItem>) => Promise<void>
  createSection: (type: string, heading: string) => Promise<void>
  createItem: (sectionId: string) => Promise<void>
  deleteItem: (sectionId: string, itemId: string) => Promise<void>
  deleteSection: (id: string) => Promise<void>
  reorderSections: (orderedIds: string[]) => Promise<void>
  reorderItems: (sectionId: string, orderedIds: string[]) => Promise<void>
  updatePage: (patch: Partial<AdminPage>) => Promise<void>
  refetch: () => Promise<void>
}

export function useAdminContent(): UseAdminContentReturn {
  const [sections, setSections] = useState<AdminSection[]>([])
  const [page, setPage] = useState<AdminPage | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetchContent = useCallback(async () => {
    debug('!!! USE_ADMIN_CONTENT_FETCH_START url=/api/admin/content')
    setLoading(true)
    setError(null)
    try {
      const { json } = await fetchJson('/api/admin/content', { cache: 'no-store' } as any)
      const data = json as any
      debug('!!! USE_ADMIN_CONTENT_FETCHED raw=' + JSON.stringify(data)?.slice(0,500))
      setSections(data.sections || [])
      setPage(data.page || null)
      debug(`!!! USE_ADMIN_CONTENT_FETCHED sections=${data.sections?.length}`)
    } catch (e: any) {
      debug('!!! USE_ADMIN_CONTENT_ERROR error=' + e?.message + ' stack=' + e?.stack?.slice(0,500))
      setError(e?.message || String(e))
      debug(`!!! USE_ADMIN_CONTENT_ERROR ${e?.message}`)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    fetchContent()
  }, [fetchContent])

  const updateSection = async (id: string, patch: Partial<AdminSection>) => {
    debug(`!!! USE_ADMIN_CONTENT_UPDATE_SECTION id=${id} patch=${JSON.stringify(patch).slice(0, 200)}`)
    const { json } = await fetchJson(`/api/admin/sections/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    } as any)
    const updated = json as AdminSection
    setSections((prev) => prev.map((s) => (s.id === id ? { ...s, ...updated } : s)))
  }

  const updateItem = async (id: string, patch: Partial<AdminItem>) => {
    debug(`!!! USE_ADMIN_CONTENT_UPDATE_ITEM id=${id} patch=${JSON.stringify(patch).slice(0, 200)}`)
    const { json } = await fetchJson(`/api/admin/items/${id}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    } as any)
    const updated = json as AdminItem
    setSections((prev) =>
      prev.map((sec) => ({
        ...sec,
        items: sec.items.map((it) => (it.id === id ? { ...it, ...updated } : it)),
      }))
    )
  }

  const reorderSections = async (orderedIds: string[]) => {
    debug(`!!! USE_ADMIN_CONTENT_REORDER_SECTIONS ${orderedIds.join(',')}`)
    await fetchJson('/api/admin/sections/reorder', {
      method: 'POST',
      body: JSON.stringify({ orderedIds }),
    } as any)
    // Optimistic reorder
    setSections((prev) => {
      const map = new Map(prev.map((s) => [s.id, s]))
      return orderedIds.map((id, idx) => ({ ...map.get(id)!, sort_order: idx } as AdminSection)).filter(Boolean)
    })
  }

  const reorderItems = async (sectionId: string, orderedIds: string[]) => {
    debug(`!!! USE_ADMIN_CONTENT_REORDER_ITEMS sec=${sectionId} ${orderedIds.join(',')}`)
    await fetchJson('/api/admin/items/reorder', {
      method: 'POST',
      body: JSON.stringify({ sectionId, orderedIds }),
    } as any)
    setSections((prev) =>
      prev.map((sec) => {
        if (sec.id !== sectionId) return sec
        const itemMap = new Map(sec.items.map((it) => [it.id, it]))
        const reordered = orderedIds.map((id, idx) => ({ ...itemMap.get(id)!, sort_order: idx } as AdminItem)).filter(Boolean)
        return { ...sec, items: reordered }
      })
    )
  }

  const createSection = async (type: string, heading: string) => {
    if (import.meta.env.DEV) debug(`!!! USE_ADMIN_CONTENT_CREATE_SECTION type=${type} heading=${heading}`)
    const { json } = await fetchJson('/api/admin/sections', {
      method: 'POST',
      body: JSON.stringify({ type, heading }),
    } as any)
    const created = json as AdminSection
    // Ensure items array exists for new section
    const withItems = { ...created, items: (created as any).items || [] } as AdminSection
    setSections((prev) => [...prev, withItems].sort((a, b) => a.sort_order - b.sort_order))
  }

  const createItem = async (sectionId: string) => {
    debug(`!!! USE_ADMIN_CONTENT_CREATE_ITEM section=${sectionId}`)
    const { json } = await fetchJson('/api/admin/items', {
      method: 'POST',
      body: JSON.stringify({ sectionId }),
    } as any)
    const created = json as AdminItem
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, items: [...s.items, created] } : s)))
  }

  const deleteItem = async (sectionId: string, itemId: string) => {
    debug(`!!! USE_ADMIN_CONTENT_DELETE_ITEM id=${itemId}`)
    await fetchJson(`/api/admin/items/${itemId}`, { method: 'DELETE' } as any)
    setSections((prev) => prev.map((s) => (s.id === sectionId ? { ...s, items: s.items.filter((i) => i.id !== itemId) } : s)))
  }

  const deleteSection = async (id: string) => {
    if (import.meta.env.DEV) debug(`!!! USE_ADMIN_CONTENT_DELETE_SECTION id=${id}`)
    await fetchJson(`/api/admin/sections/${id}`, { method: 'DELETE' } as any)
    setSections((prev) => prev.filter((s) => s.id !== id))
  }

  const updatePage = async (patch: Partial<AdminPage>) => {
    const slug = page?.slug || 'home'
    debug(`!!! USE_ADMIN_CONTENT_UPDATE_PAGE slug=${slug} patch=${JSON.stringify(patch)}`)
    const { json } = await fetchJson(`/api/admin/pages/${slug}`, {
      method: 'PUT',
      body: JSON.stringify(patch),
    } as any)
    setPage(json as AdminPage)
  }

  return {
    sections,
    page,
    loading,
    error,
    updatePage,
    updateSection,
    updateItem,
    createSection,
    deleteSection,
    createItem,
    deleteItem,
    reorderSections,
    reorderItems,
    refetch: fetchContent,
  }
}
