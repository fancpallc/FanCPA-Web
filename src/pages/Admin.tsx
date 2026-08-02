import React, { useState } from 'react'
import { useAdminAuth } from '../hooks/useAdminAuth'
import { useAdminContent, type AdminItem } from '../hooks/useAdminContent'
import { EditableText } from '../components/admin/EditableText'
import { ImageUploader } from '../components/admin/ImageUploader'
import { IconPicker } from '../components/admin/IconPicker'
import { RatingPicker } from '../components/admin/RatingPicker'
import { CalendarView } from '../components/calendar/CalendarView'
import { ManageBookings } from '../components/calendar/ManageBookings'
import { useCalendar } from '../hooks/useCalendar'
import { fetchR2Usage } from '../lib/api'
import { isDeadAnchor } from '../lib/anchors'

/** Anchor each visible section type contributes to the live page. Mirrors Home. */
const ANCHOR_BY_TYPE: Record<string, string> = {
  'cards-grid': 'services',
  'text-block': 'about',
  testimonials: 'testimonials',
  'image-gallery': 'work',
}

/**
 * The background each section paints on the live page. The preview rendered every
 * section on white, so the alternating white/slate-50 rhythm the visitor sees — About
 * and Gallery tinted, Services and Testimonials plain — was invisible to the owner.
 * `hero` matches the .hero rule in index.css.
 */
const SECTION_BG: Record<string, string> = {
  hero: 'bg-hero',
  'cards-grid': 'bg-white',
  'text-block': 'bg-slate-50',
  testimonials: 'bg-white',
  'image-gallery': 'bg-slate-50',
}

/** Human names for the section types — the raw slugs read as developer jargon in the UI. */
const SECTION_LABELS: Record<string, string> = {
  hero: 'Hero',
  'text-block': 'About',
  'cards-grid': 'Services',
  testimonials: 'Testimonials',
  'cta-banner': 'Call to action',
  'image-gallery': 'Gallery',
}

function sectionLabel(type: string): string {
  return SECTION_LABELS[type] || type.replace(/-/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase())
}

/** Storage figures read in MB up to 1 GB, then in GB — "10240MB" is not a human number. */
function formatStorage(megabytes: number): string {
  return megabytes >= 1024 ? `${(megabytes / 1024).toFixed(1)} GB` : `${megabytes} MB`
}

function getOldKeyFromUrl(url?: string | null): string | undefined {
  if (!url) return undefined
  try {
    let path = url
    if (url.startsWith('http://') || url.startsWith('https://')) {
      const u = new URL(url)
      path = u.pathname
    }
    path = path.split('?')[0]
    if (path.includes('/api/images/')) {
      const idx = path.indexOf('/api/images/')
      let key = path.slice(idx + '/api/images/'.length)
      if (key.startsWith('/')) key = key.slice(1)
      if (key.startsWith('portfolio/')) return key
    }
    if (path.startsWith('/api/images/')) return path.replace('/api/images/', '')
    if (path.startsWith('portfolio/')) return path.split('?')[0]
    return undefined
  } catch {
    return undefined
  }
}

export function Admin() {
  const auth = useAdminAuth()
  const { data, loading, error, isAuthed, isBypass, email, refetch } = auth
  const content = useAdminContent()
  // Only for the read-only booking preview below — the admin does not edit slots.
  const { grouped: calendarSlots, slotMinutes, excludeToday } = useCalendar(2)
  const [quota, setQuota] = useState<any>(null)
  const [quotaLoading, setQuotaLoading] = useState(false)
  const [globalError, setGlobalError] = useState<string | null>(null)
  const [newSectionType, setNewSectionType] = useState('text-block')
  const [newSectionHeading, setNewSectionHeading] = useState('')
  const [newSectionError, setNewSectionError] = useState<string | null>(null)

  const handleCheckQuota = async () => {
    setQuotaLoading(true)
    try {
      const result = await fetchR2Usage(true)
      setQuota(result)
    } catch (e: any) {
      setGlobalError(e?.message || String(e))
    } finally {
      setQuotaLoading(false)
    }
  }

  const handleAddSection = async () => {
    // Reported next to the field, not as a banner pinned 200px away at the top of the page.
    if (!newSectionHeading.trim()) {
      setNewSectionError('Give the new section a heading first.')
      return
    }
    try {
      await content.createSection(newSectionType, newSectionHeading.trim())
      setNewSectionHeading('')
      setNewSectionError(null)
    } catch (e: any) {
      setNewSectionError(e?.message || String(e))
    }
  }

  if (loading) {
    return <div className="max-w-3xl mx-auto px-6 py-24 text-center text-sm text-gray-600">Checking admin access…</div>
  }

  if (!isAuthed) {
    return (
      <div className="max-w-2xl mx-auto px-6 py-20">
        <div className="rounded-2xl border bg-amber-50 p-8 text-center shadow-sm">
          <h1 className="text-2xl font-black tracking-tight mb-3" style={{ fontFamily: 'Playfair Display, serif' }}>Sign in to edit your site</h1>
          <p className="text-sm text-gray-700 mb-2">Sign in with the Google account that owns this site.</p>
          {data?.error && <div className="text-xs bg-white border p-2 rounded-lg mt-2 break-all">{data.error}</div>}
          {error && <div className="text-xs bg-white border border-red-200 text-red-700 p-2 rounded-lg mt-2">{error}</div>}
          <div className="flex gap-3 justify-center mt-4">
            <button onClick={() => refetch()} className="px-6 py-3 bg-slate-900 text-white rounded-full text-sm font-semibold">Sign in with Google</button>
            <a href="/" className="px-6 py-3 bg-white border border-slate-500 rounded-full text-sm font-semibold">Back to home</a>
          </div>
        </div>
      </div>
    )
  }

  const addItem = async (sectionId: string) => {
    try { await content.createItem(sectionId) } catch (e: any) { setGlobalError(e?.message || String(e)) }
  }

  const removeItem = async (sectionId: string, itemId: string, label: string) => {
    if (!confirm(`Remove ${label}? This cannot be undone.`)) return
    try { await content.deleteItem(sectionId, itemId) } catch (e: any) { setGlobalError(e?.message || String(e)) }
  }

  const AddItemButton = ({ sectionId, label }: { sectionId: string; label: string }) => (
    <button
      onClick={() => addItem(sectionId)}
      className="px-4 min-h-11 inline-flex items-center gap-1.5 bg-white border border-dashed border-slate-500 rounded-full text-xs font-semibold hover:border-slate-900"
    >
      <span aria-hidden>+</span> Add {label}
    </button>
  )

  /**
   * Publish state + removal for a single item. New items start unpublished, so this
   * is also the only thing standing between a blank card and the live site.
   */
  const ItemControls = ({ item, sectionId, label }: { item: AdminItem; sectionId: string; label: string }) => (
    <div className="flex flex-wrap items-center gap-2">
      {!item.is_visible && (
        <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px]">
          Not on your live site yet
        </span>
      )}
      <button
        onClick={async () => {
          try { await content.updateItem(item.id, { is_visible: item.is_visible ? 0 : 1 } as any) } catch (e: any) { setGlobalError(e?.message) }
        }}
        aria-label={`${item.is_visible ? 'Unpublish' : 'Publish'} ${label}`}
        className="px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-[11px] hover:border-slate-900"
      >
        {item.is_visible ? 'Unpublish' : 'Publish'}
      </button>
      <button
        onClick={() => removeItem(sectionId, item.id, label)}
        aria-label={`Remove ${label}`}
        className="px-3 min-h-11 inline-flex items-center bg-white border border-red-600 text-red-700 rounded-full text-[11px] hover:bg-red-50"
      >
        Remove
      </button>
    </div>
  )

  /**
   * Only rendered once an image exists. Images shipped with `alt=""` and no editor, so a
   * screen-reader visitor got nothing at all for the biggest picture on the page — and
   * the owner had no way to tell, or to fix it.
   */
  const AltTextField = ({ item, what }: { item: AdminItem; what: string }) =>
    item.image_url ? (
      <div className="pt-1">
        {/* An empty description is invisible on the live site, so the owner has no way
            to notice one is missing. Every seeded image shipped without one. */}
        <div className="editor-chrome text-[11px] text-gray-500 mb-1 flex flex-wrap items-center gap-1.5">
          Describe this image (for people using a screen reader)
          {!item.image_alt?.trim() && (
            <span className="px-2 py-0.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px]">
              Missing
            </span>
          )}
        </div>
        <div className="text-xs text-gray-600">
          <EditableText
            value={item.image_alt || ''}
            onSave={async (v) => { try { await content.updateItem(item.id, { image_alt: v } as any) } catch (e: any) { setGlobalError(e?.message) } }}
            placeholder={`e.g. ${what}`}
            ariaLabel={`Image description for ${what}`}
            displayClassName="text-xs text-gray-600"
            inputClassName="text-xs"
          />
        </div>
      </div>
    ) : null

  const EmptySection = ({ sectionId, label }: { sectionId: string; label: string }) => (
    <div className="border border-dashed border-slate-300 rounded-2xl p-8 text-center">
      <p className="text-sm text-gray-600 mb-3">Nothing here yet.</p>
      <AddItemButton sectionId={sectionId} label={label} />
    </div>
  )

  const sortedSections = [...content.sections].sort((a, b) => a.sort_order - b.sort_order)
  // Same set the live page builds, so the preview can warn when a button points at a
  // section the owner has hidden — the live site quietly swaps in a booking link.
  const liveAnchors = new Set([
    'calendar',
    'contact',
    ...sortedSections.filter((s) => s.is_visible).map((s) => ANCHOR_BY_TYPE[s.type]).filter(Boolean),
  ])

  return (
    <div className="bg-slate-50 min-h-screen">
      <a href="#admin-main" className="sr-only focus:not-sr-only">Skip to content</a>
      <div className="sticky top-0 z-40 bg-white border-b">
        <div className="max-w-5xl mx-auto px-6 py-3 flex flex-wrap justify-between items-center gap-3">
          <div className="flex items-center gap-2 text-xs">
            {/* Not an <h1>: the hero preview below carries the page's real heading. */}
            <span className="text-sm font-black tracking-tight">Admin</span>
            <span className="w-1 h-1 bg-gray-300 rounded-full" aria-hidden />
            {isBypass ? (
              <span className="px-2 py-0.5 rounded-full bg-slate-900 text-white text-[10px]">Local preview — sign-in skipped</span>
            ) : (
              <span className="text-gray-600 font-medium">Signed in as {email}</span>
            )}
          </div>
          <div className="flex flex-wrap gap-2 items-center">
            <button onClick={handleCheckQuota} disabled={quotaLoading} className="px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-[11px] font-semibold hover:border-slate-900 disabled:opacity-50" aria-label="Check storage usage">
              {quotaLoading ? 'Checking…' : quota ? `Storage ${formatStorage(quota.totalMB)} of ${formatStorage(quota.limitMB)}` : 'Check storage'}
            </button>
            <button onClick={() => { refetch(); content.refetch() }} className="px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-[11px] font-semibold hover:border-slate-900" aria-label="Reload content from the server" title="Reload content from the server">Refresh</button>
            <a href="/" className="px-3 min-h-11 inline-flex items-center bg-slate-900 text-white rounded-full text-[11px] font-semibold" aria-label="View site">View site</a>
          </div>
        </div>
        {globalError && <div className="max-w-5xl mx-auto px-6 pb-2"><div className="p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700" role="alert">{globalError}</div></div>}
        {content.error && <div className="max-w-5xl mx-auto px-6 pb-2"><div className="p-2 bg-red-50 border border-red-200 rounded-xl text-xs text-red-700">Content error: {content.error}</div></div>}
        {quota && (
          <div className="max-w-5xl mx-auto px-6 pb-3">
            <div className="p-2.5 bg-white rounded-xl border text-[11px] flex flex-wrap gap-3 items-center">
              <span>{quota.totalObjects} images stored</span>
              <div className="w-24 h-1.5 bg-slate-200 rounded-full overflow-hidden" aria-label={`Storage ${quota.percent}% used`}>
                <div className="h-full bg-slate-900" style={{ width: `${Math.min(100, quota.percent)}%` }} />
              </div>
              <span className={quota.warning ? 'text-red-600 font-semibold' : 'text-green-700'}>{quota.warning ? 'Almost full — remove some images' : 'Plenty of room'}</span>

            </div>
          </div>
        )}
      </div>

      {content.loading ? (
        <main id="admin-main" className="max-w-5xl mx-auto px-6 py-24 text-center text-sm text-gray-500">Loading portfolio content…</main>
      ) : (
        // <main>, because the admin ships its own toolbar instead of the shared Layout
        // and so inherited neither the landmark nor the skip link the public page has.
        <main id="admin-main" tabIndex={-1} className="max-w-5xl mx-auto px-6 py-8 space-y-10 block">
          <p className="text-sm text-gray-600">
            This is your live site. Click any text to edit it, or click an image to replace it —
            every change saves straight away.
          </p>

          {/* The site's own name lived in three components as the literal "Portfolio", so
              a portfolio belonging to Jane Doe shipped with a stranger's placeholder in the
              header, the footer brand and the copyright line, and no field to change it. */}
          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-3">Your site</p>
            <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
              <div>
                <div className="editor-chrome text-[11px] text-gray-500 mb-1">Site name — shown in the header and the footer</div>
                <div className="font-bold">
                  <EditableText
                    value={content.page?.site_name || ''}
                    onSave={async (v) => { try { await content.updatePage({ site_name: v }) } catch (e: any) { setGlobalError(e?.message); throw e } }}
                    placeholder="Your name or studio"
                    required
                    ariaLabel="Site name"
                    displayClassName="font-bold"
                    inputClassName="font-bold"
                  />
                </div>
              </div>
              <div>
                <div className="editor-chrome text-[11px] text-gray-500 mb-1">Footer line — the sentence under your name</div>
                <div className="text-sm text-gray-600">
                  <EditableText
                    value={content.page?.footer_tagline || ''}
                    onSave={async (v) => { try { await content.updatePage({ footer_tagline: v }) } catch (e: any) { setGlobalError(e?.message); throw e } }}
                    placeholder="What you do, in one sentence"
                    multiline
                    ariaLabel="Footer tagline"
                    displayClassName="text-sm text-gray-600"
                  />
                </div>
              </div>
              <div>
                <div className="editor-chrome text-[11px] text-gray-500 mb-1">Browser tab title — also the headline on Google</div>
                <div className="text-sm">
                  <EditableText
                    value={content.page?.title || ''}
                    onSave={async (v) => { try { await content.updatePage({ title: v }) } catch (e: any) { setGlobalError(e?.message); throw e } }}
                    placeholder="Jane Doe — Designer & Developer"
                    required
                    ariaLabel="Browser tab title"
                    displayClassName="text-sm"
                  />
                </div>
              </div>
              <div>
                <div className="editor-chrome text-[11px] text-gray-500 mb-1">Search description — the grey text under your Google result</div>
                <div className="text-sm text-gray-600">
                  <EditableText
                    value={content.page?.meta_description || ''}
                    onSave={async (v) => { try { await content.updatePage({ meta_description: v }) } catch (e: any) { setGlobalError(e?.message); throw e } }}
                    placeholder="One or two sentences about what you do"
                    multiline
                    ariaLabel="Search description"
                    displayClassName="text-sm text-gray-600"
                  />
                </div>
              </div>
            </div>
          </div>

          <div className="p-4 border rounded-2xl bg-white shadow-sm">
            <p className="text-xs font-bold uppercase tracking-widest text-gray-500 mb-2">Add a section</p>
            <div className="flex flex-wrap gap-2 items-center">
              <select value={newSectionType} onChange={(e) => setNewSectionType(e.target.value)} aria-label="New section type" className="px-3 min-h-11 border border-slate-500 rounded-xl text-xs bg-white">
                <option value="hero">Hero — Top landing section with headline</option>
                <option value="text-block">About Me — Text block with story</option>
                <option value="cards-grid">Services — Branding & more cards grid</option>
                <option value="testimonials">Testimonials — Client quotes with author</option>
                <option value="cta-banner">CTA Banner — Call to action with button</option>
                <option value="image-gallery">Image Gallery — Portfolio work grid</option>
              </select>
              <input type="text" value={newSectionHeading} onChange={(e) => { setNewSectionHeading(e.target.value); setNewSectionError(null) }} placeholder="New section heading" className={`px-3 min-h-11 border border-slate-500 rounded-xl text-xs min-w-[200px] ${newSectionError ? 'border-red-300' : ''}`} aria-label="New section heading" aria-invalid={Boolean(newSectionError)} />
              <button onClick={handleAddSection} className="px-4 min-h-11 inline-flex items-center bg-slate-900 text-white rounded-full text-xs font-semibold hover:bg-black" aria-label="Add section">Add section</button>
              <span className="text-[11px] text-gray-500">
                {sortedSections.length} sections · {sortedSections.filter((s) => s.is_visible).length} live
              </span>
            </div>
            {newSectionError && <p className="mt-2 text-[11px] text-red-700" role="alert">{newSectionError}</p>}
          </div>

          {sortedSections.map((section, secIdx) => {
            const isHidden = !section.is_visible
            const items = [...(section.items || [])].sort((a, b) => a.sort_order - b.sort_order)
            return (
              // No `group` here: `group-hover` inside matches any ancestor, so hovering one
              // gallery tile lit up the replace overlay on all six.
              <div key={section.id} data-section className={`relative rounded-2xl border bg-white shadow-sm overflow-hidden ${isHidden ? 'border-dashed border-amber-300' : 'border-slate-200'}`}>
                {/* A real header strip, not a hover-revealed overlay: the controls used to be
                    invisible until you happened to mouse over the card, so nothing on the page
                    told the owner it was editable at all. */}
                <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b bg-slate-50">
                  <div className="flex flex-wrap items-center gap-2">
                  <span className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] tracking-wide shadow-sm border border-slate-800">{sectionLabel(section.type)} · Section {secIdx + 1} of {sortedSections.length}</span>
                  {isHidden && (
                    <span className="px-3 py-1.5 rounded-full bg-amber-100 text-amber-800 border border-amber-200 text-[10px] shadow-sm">
                      Hidden — not on live site
                    </span>
                  )}
                  </div>
                  <div className="flex flex-wrap items-center justify-end gap-2">
                  <button aria-label="Move section up" disabled={secIdx === 0} onClick={async () => {
                    try {
                      const sorted = [...content.sections].sort((a, b) => a.sort_order - b.sort_order)
                      const idx = sorted.findIndex((s) => s.id === section.id)
                      if (idx > 0) { const tmp = sorted[idx - 1]; sorted[idx - 1] = sorted[idx]; sorted[idx] = tmp; await content.reorderSections(sorted.map((s) => s.id)) }
                    } catch (e: any) { setGlobalError(e?.message) }
                  }} className="px-3 min-h-11 inline-flex items-center justify-center bg-white border border-slate-500 rounded-full text-[11px] disabled:opacity-20 hover:border-slate-900 gap-1"><span aria-hidden>↑</span> Up</button>
                  <button aria-label="Move section down" disabled={secIdx === sortedSections.length - 1} onClick={async () => {
                    try {
                      const sorted = [...content.sections].sort((a, b) => a.sort_order - b.sort_order)
                      const idx = sorted.findIndex((s) => s.id === section.id)
                      if (idx < sorted.length - 1) { const tmp = sorted[idx + 1]; sorted[idx + 1] = sorted[idx]; sorted[idx] = tmp; await content.reorderSections(sorted.map((s) => s.id)) }
                    } catch (e: any) { setGlobalError(e?.message) }
                  }} className="px-3 min-h-11 inline-flex items-center justify-center bg-white border border-slate-500 rounded-full text-[11px] disabled:opacity-20 hover:border-slate-900 gap-1"><span aria-hidden>↓</span> Down</button>
                  <button aria-label={isHidden ? 'Show section' : 'Hide section'} onClick={async () => {
                    try { await content.updateSection(section.id, { is_visible: isHidden ? 1 : 0 } as any) } catch (e: any) { setGlobalError(e?.message) }
                  }} className="px-3 min-h-11 inline-flex items-center justify-center bg-white border border-slate-500 rounded-full text-[11px] hover:border-slate-900">{isHidden ? 'Show' : 'Hide'}</button>
                  <button aria-label="Delete section" onClick={async () => {
                    if (!confirm(`Delete the ${sectionLabel(section.type)} section "${section.heading}"? ${section.items.length ? `Its ${section.items.length} ${section.items.length === 1 ? 'item is' : 'items are'} deleted too. ` : ''}This cannot be undone.`)) return
                    try { await content.deleteSection(section.id) } catch (e: any) { setGlobalError(e?.message) }
                  }} className="px-3 min-h-11 inline-flex items-center justify-center bg-white border border-red-600 text-red-700 rounded-full text-[11px] hover:bg-red-50">Delete</button>
                  </div>
                </div>
                {/* Tinted rather than dimmed: a blanket opacity/grayscale dropped body text
                    under WCAG AA and turned inline error messages grey. */}
                {/* The amber "hidden" tint wins over the section's own background —
                    two competing washes would just read as a muddy third colour. */}
                <div className={isHidden ? 'bg-amber-50' : SECTION_BG[section.type] || ''}>
                {section.type === 'hero' && (
                  <div className="py-20 lg:py-24 px-6 sm:px-8">
                    <div className="max-w-5xl mx-auto">
                      <div className="flex flex-col lg:flex-row gap-10 items-center">
                        <div className="flex-1 w-full">
                          {/* Mirrors the live hero so the preview isn't missing pieces the
                              owner can see on their own site. */}
                          <div className="flex items-center gap-2 text-xs font-semibold tracking-widest uppercase text-gray-500 mb-5">
                            <span className="w-2 h-2 rounded-full bg-green-500 inline-block" aria-hidden />
                            Available for new projects
                          </div>
                          <h1 className="text-4xl lg:text-5xl font-black leading-tight tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>
                            <EditableText value={section.heading || ''} onSave={async (v) => { try { await content.updateSection(section.id, { heading: v } as any) } catch (e: any) { setGlobalError(e?.message) } }} placeholder="Hero heading" required ariaLabel="Hero heading" displayClassName="text-4xl lg:text-5xl font-black" inputClassName="text-4xl lg:text-5xl font-black" />
                          </h1>
                          <div className="text-xl text-gray-600 mb-4 max-w-[60ch]">
                            <EditableText value={section.subheading || ''} onSave={async (v) => { try { await content.updateSection(section.id, { subheading: v } as any) } catch (e: any) { setGlobalError(e?.message) } }} placeholder="Subheading" multiline ariaLabel="Hero subheading" displayClassName="text-xl text-gray-600" inputClassName="text-xl text-gray-600" />
                          </div>
                          {items[0] && (
                            <div className="space-y-3 max-w-[60ch]">
                              <div className="text-gray-600"><EditableText value={items[0].body || ''} onSave={async (v) => { try { await content.updateItem(items[0].id, { body: v } as any) } catch (e: any) { setGlobalError(e?.message) } }} placeholder="Body" multiline /></div>
                              <div className="pt-2 inline-flex items-center gap-2 px-5 py-3 rounded-full bg-slate-900 text-white text-sm font-semibold">
                                <EditableText
                                  value={items[0].link_text || ''}
                                  onSave={async (v) => { try { await content.updateItem(items[0].id, { link_text: v } as any) } catch (e: any) { setGlobalError(e?.message) } }}
                                  placeholder="Button label"
                                  ariaLabel="Hero button label"
                                  displayClassName="text-sm font-semibold"
                                  inputClassName="text-sm"
                                />
                              </div>
                              {isDeadAnchor(items[0].link_url, liveAnchors) && (
                                <p className="text-[11px] text-amber-800 bg-amber-50 border border-amber-200 rounded-lg px-2.5 py-1.5">
                                  This button points at a section that is hidden, so your live site shows
                                  “Book a free call” and links to the booking calendar instead.
                                </p>
                              )}
                            </div>
                          )}
                        </div>
                        <div className="flex-1 w-full">
                          {items[0] && (
                            <div className="space-y-2">
                              <ImageUploader
                                variant="hero"
                                inputId={`upload-${items[0].id}`}
                                currentImageUrl={items[0].image_url || undefined}
                                oldKey={getOldKeyFromUrl(items[0].image_url)}
                                onUploadComplete={async (r) => { await content.updateItem(items[0].id, { image_url: r.url } as any) }}
                              />
                              <AltTextField item={items[0]} what="a photo of you at your desk" />
                            </div>
                          )}
                        </div>
                      </div>
                    </div>
                  </div>
                )}

                {section.type === 'cards-grid' && (
                  <div className="py-20 lg:py-24 px-6 sm:px-8">
                    <div className="text-center mb-8">
                      <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-2"><EditableText value={section.heading || ''} onSave={async (v) => content.updateSection(section.id, { heading: v } as any)} placeholder="Services heading" displayClassName="text-3xl lg:text-4xl font-black" inputClassName="text-3xl lg:text-4xl font-black" /></h2>
                      <div className="text-gray-600"><EditableText value={section.subheading || ''} onSave={async (v) => content.updateSection(section.id, { subheading: v } as any)} placeholder="Subheading" /></div>
                    </div>
                    {items.length === 0 ? <EmptySection sectionId={section.id} label="a service" /> : (
                    <div className="grid sm:grid-cols-2 lg:grid-cols-3 gap-6 lg:gap-8">
                      {items.map((item) => (
                        <div key={item.id} className="card p-8">
                          <div className="mb-5"><IconPicker icon={item.icon} label={item.title || 'this service'} onSave={async (v) => { await content.updateItem(item.id, { icon: v } as any) }} /></div>
                          <div className="font-bold"><EditableText value={item.title || ''} onSave={async (v) => content.updateItem(item.id, { title: v } as any)} placeholder="Service name" displayClassName="font-bold" inputClassName="font-bold" /></div>
                          <div className="text-sm text-gray-600 mt-1"><EditableText value={item.body || ''} onSave={async (v) => content.updateItem(item.id, { body: v } as any)} placeholder="Short description" multiline /></div>
                          <div className="mt-2"><ImageUploader currentImageUrl={item.image_url} oldKey={getOldKeyFromUrl(item.image_url)} onUploadComplete={async (r) => await content.updateItem(item.id, { image_url: r.url } as any)} /></div>
                          <AltTextField item={item} what={item.title || 'this service'} />
                          <div className="mt-3"><ItemControls item={item} sectionId={section.id} label={item.title || 'this service'} /></div>
                        </div>
                      ))}
                    </div>
                    )}
                    {items.length > 0 && <div className="mt-5"><AddItemButton sectionId={section.id} label="a service" /></div>}
                  </div>
                )}

                {section.type === 'text-block' && (
                  <div className="py-20 lg:py-24 px-6 sm:px-8">
                    {items.length === 0 && <EmptySection sectionId={section.id} label="your story" />}
                    {items.map((item) => (
                      // Photo left, text right — the same two-column split the live section
                      // uses, so the preview is not a differently-shaped page.
                      <div key={item.id} className="flex flex-col lg:flex-row gap-8 lg:gap-12 lg:items-center">
                        <div className="flex-1 w-full space-y-3">
                          <ImageUploader variant="hero" label="about" currentImageUrl={item.image_url} oldKey={getOldKeyFromUrl(item.image_url)} onUploadComplete={async (r) => await content.updateItem(item.id, { image_url: r.url } as any)} />
                          <AltTextField item={item} what="a portrait of you" />
                          <ItemControls item={item} sectionId={section.id} label="this block" />
                        </div>
                        <div className="flex-1 w-full space-y-2">
                          <h2 className="text-3xl lg:text-4xl font-black"><EditableText value={section.heading || ''} onSave={async (v) => content.updateSection(section.id, { heading: v } as any)} placeholder="About heading" displayClassName="text-3xl lg:text-4xl font-black" inputClassName="text-3xl lg:text-4xl font-black" /></h2>
                          <div className="text-lg text-gray-600"><EditableText value={section.subheading || ''} onSave={async (v) => content.updateSection(section.id, { subheading: v } as any)} placeholder="About subheading" ariaLabel="About subheading" displayClassName="text-lg text-gray-600" /></div>
                          <div className="font-semibold"><EditableText value={item.title || ''} onSave={async (v) => content.updateItem(item.id, { title: v } as any)} placeholder="Your name" /></div>
                          <div className="text-gray-600"><EditableText value={item.body || ''} onSave={async (v) => content.updateItem(item.id, { body: v } as any)} placeholder="Your story" multiline displayClassName="text-gray-600 leading-relaxed" /></div>
                          <div className="p-4 bg-white border border-slate-200 rounded-xl text-sm">
                            <div className="font-semibold mb-1">Credentials &amp; Experience</div>
                            <div className="text-gray-600"><EditableText value={item.author || ''} onSave={async (v) => content.updateItem(item.id, { author: v } as any)} placeholder="Credentials" ariaLabel="Credentials and experience" /></div>
                          </div>
                          <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-slate-900 text-white text-sm font-semibold">Book a free call</div>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                {section.type === 'testimonials' && (
                  <div className="py-20 lg:py-24 px-6 sm:px-8">
                    <h2 className="text-3xl lg:text-4xl font-black mb-6 text-center"><EditableText value={section.heading || ''} onSave={(v) => content.updateSection(section.id, { heading: v } as any)} placeholder="Testimonials heading" displayClassName="text-3xl lg:text-4xl font-black" /></h2>
                    {items.length === 0 ? <EmptySection sectionId={section.id} label="a testimonial" /> : (
                    <div className="grid md:grid-cols-3 gap-6">
                      {items.map((item) => (
                        <div key={item.id} className="p-5 border rounded-2xl bg-slate-50">
                          <div className="mb-2"><RatingPicker rating={item.rating} label={item.author || 'this testimonial'} onSave={async (v) => { try { await content.updateItem(item.id, { rating: v } as any) } catch (e: any) { setGlobalError(e?.message); throw e } }} /></div>
                          <div className="text-sm"><EditableText value={item.body || ''} onSave={(v) => content.updateItem(item.id, { body: v } as any)} placeholder="Testimonial body" multiline /></div>
                          <div className="mt-3 text-sm font-semibold"><EditableText value={item.author || ''} onSave={(v) => content.updateItem(item.id, { author: v } as any)} placeholder="Author" /></div>
                          <div className="text-xs text-gray-600"><EditableText value={item.title || ''} onSave={(v) => content.updateItem(item.id, { title: v } as any)} placeholder="Role" ariaLabel="Testimonial author role" displayClassName="text-xs text-gray-600" /></div>
                          <div className="mt-3"><ItemControls item={item} sectionId={section.id} label={item.author || 'this testimonial'} /></div>
                        </div>
                      ))}
                    </div>
                    )}
                    {items.length > 0 && <div className="mt-5"><AddItemButton sectionId={section.id} label="a testimonial" /></div>}
                  </div>
                )}

                {section.type === 'cta-banner' && (
                  // py-20 like the live banner (CTABanner.tsx:18). At p-2 the preview
                  // gave this section 8px of breathing room against the live 80px.
                  <div className="py-20 lg:py-24 px-6">
                    <div className="bg-slate-900 text-white rounded-2xl p-8 text-center">
                      <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-white/10 border border-white/10 text-xs font-medium mb-5">
                        <span className="w-1.5 h-1.5 rounded-full bg-green-400 inline-block" aria-hidden />
                        Available for new projects
                      </div>
                      <h2 className="text-3xl lg:text-4xl font-black mb-3"><EditableText value={section.heading || ''} onSave={(v) => content.updateSection(section.id, { heading: v } as any)} placeholder="CTA heading" displayClassName="text-white text-3xl lg:text-4xl font-black" inputClassName="text-3xl lg:text-4xl font-black" /></h2>
                      <div className="text-gray-300 mb-4"><EditableText value={section.subheading || ''} onSave={(v) => content.updateSection(section.id, { subheading: v } as any)} placeholder="Subheading" multiline /></div>
                      {items[0] && (
                        <div className="inline-flex items-center gap-2 px-6 py-3 rounded-full bg-white text-slate-900 font-bold">
                          <EditableText value={items[0].link_text || ''} onSave={(v) => content.updateItem(items[0].id, { link_text: v } as any)} placeholder="Button label" ariaLabel="CTA button label" displayClassName="font-bold" inputClassName="text-sm" />
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {section.type === 'image-gallery' && (
                  <div className="py-20 lg:py-24 px-6 sm:px-8">
                    <h2 className="text-3xl lg:text-4xl font-black mb-6"><EditableText value={section.heading || ''} onSave={(v) => content.updateSection(section.id, { heading: v } as any)} placeholder="Gallery heading" /></h2>
                    {items.length === 0 ? <EmptySection sectionId={section.id} label="a project" /> : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-6 lg:gap-8">
                      {items.map((item) => (
                        <div key={item.id} className="space-y-2">
                          <ImageUploader variant="hero" label={item.title || 'gallery'} currentImageUrl={item.image_url} oldKey={getOldKeyFromUrl(item.image_url)} onUploadComplete={async (r) => await content.updateItem(item.id, { image_url: r.url } as any)} />
                          <AltTextField item={item} what={item.title || 'this project'} />
                          <EditableText value={item.title || ''} onSave={(v) => content.updateItem(item.id, { title: v } as any)} placeholder="Image title" />
                          <div className="text-xs text-gray-600"><EditableText value={item.body || ''} onSave={(v) => content.updateItem(item.id, { body: v } as any)} placeholder="Caption" ariaLabel="Project caption" displayClassName="text-xs text-gray-600" /></div>
                          <ItemControls item={item} sectionId={section.id} label={item.title || 'this project'} />
                        </div>
                      ))}
                    </div>
                    )}
                    {items.length > 0 && <div className="mt-5"><AddItemButton sectionId={section.id} label="a project" /></div>}
                  </div>
                )}
                </div>
              </div>
            )
          })}

          {/* The booking calendar and the lookup form are on the owner's live page but
              are not database sections, so the preview used to stop at the last
              editable section and two of the owner's own sections were invisible here.
              Read-only: they run off Google Calendar, there is nothing to edit, and a
              live replica would be a second set of controls that book nothing. The
              caption carries the meaning for screen readers; the replica below it is
              aria-hidden so it is not announced as a duplicate, dead form. */}
          <div className="rounded-2xl border border-slate-200 bg-white shadow-sm overflow-hidden">
            <div className="flex flex-wrap items-center justify-between gap-2 px-4 sm:px-6 py-3 border-b bg-slate-50">
              <span className="px-3 py-1.5 rounded-full bg-slate-900 text-white text-[10px] tracking-wide shadow-sm border border-slate-800">
                Booking · always on your live site
              </span>
              <span className="text-[11px] text-gray-600">
                Preview only — your visitors book here. Times come from your Google Calendar, so there is nothing to edit.
              </span>
            </div>
            <div className="pointer-events-none" aria-hidden>
              <section className="py-20 lg:py-24 bg-slate-50 border-t">
                <div className="max-w-5xl mx-auto px-6">
                  <div className="max-w-3xl mx-auto text-center mb-10">
                    <h2 className="text-3xl lg:text-4xl font-black tracking-tight mb-4" style={{ fontFamily: 'Playfair Display, serif' }}>Book a meeting</h2>
                    <p className="text-gray-600 leading-relaxed">Pick a time that works for you. No pitch, just practical next steps.</p>
                  </div>
                  <CalendarView grouped={calendarSlots} selectedDate={null} onDateSelect={() => {}} excludeToday={excludeToday} slotMinutes={slotMinutes} />
                </div>
              </section>
              <ManageBookings />
            </div>
          </div>
        </main>
      )}
    </div>
  )
}
