import React, { useEffect, useRef, useState } from 'react'

/** Enough coverage for a services grid without turning into an emoji keyboard. */
export const ICON_CHOICES = ['🎯', '✨', '💻', '🎨', '📸', '💡', '🚀', '📐', '🧭', '📊', '🛠️', '📝', '🤝', '🔍', '⚡', '🌱', '📣', '🏆']

export interface IconPickerProps {
  icon?: string | null
  onSave: (icon: string) => Promise<void> | void
  /** Names the service in the labels, so six pickers on one page stay distinguishable. */
  label?: string
}

/**
 * The icon used to be an EditableText dropped straight into the 48px tile. Its "✎ Edit"
 * hint made the trigger 64px wide, so the glyph was shoved off-centre and out of the
 * rounded box — the icons in a services row visibly failed to line up. Here the tile is
 * the button, the glyph is centred in it, and the choices open underneath.
 */
export function IconPicker({ icon, onSave, label = 'this service' }: IconPickerProps) {
  const [open, setOpen] = useState(false)
  const [custom, setCustom] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)

  const current = icon || '✦'

  // Escape and click-away, the same as the mobile menu. Without them the only way out
  // was the Close button, which is not where anyone reaches first.
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setOpen(false)
    }
    const onClick = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('keydown', onKey)
    document.addEventListener('mousedown', onClick)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('mousedown', onClick)
    }
  }, [open])

  const choose = async (value: string) => {
    const trimmed = value.trim()
    if (!trimmed) {
      setError('Pick an icon or type one first.')
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      setOpen(false)
      setCustom('')
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="space-y-2" ref={rootRef}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-label={`Change the icon for ${label}`}
        // The live page draws this tile as decoration; here it is a button, so its
        // boundary has to be perceivable (3:1) rather than the decorative hairline.
        className="w-12 h-12 rounded-xl bg-slate-50 border border-slate-500 hover:border-slate-900 inline-flex items-center justify-center"
      >
        <span aria-hidden style={{ fontSize: '22px', lineHeight: 1 }}>
          {current}
        </span>
      </button>

      {open && (
        <div className="p-3 border border-slate-200 rounded-xl bg-white space-y-2">
          <div className="editor-chrome text-[11px] text-gray-500">Pick an icon</div>
          <div className="flex flex-wrap gap-1">
            {ICON_CHOICES.map((choice) => (
              <button
                key={choice}
                type="button"
                disabled={saving}
                aria-label={`Use ${choice} for ${label}`}
                aria-pressed={choice === current}
                onClick={() => choose(choice)}
                className={`w-11 h-11 inline-flex items-center justify-center rounded-lg border hover:border-slate-900 disabled:opacity-50 ${
                  choice === current ? 'border-slate-900 bg-slate-50' : 'border-slate-500 bg-white'
                }`}
              >
                <span aria-hidden style={{ fontSize: '18px', lineHeight: 1 }}>
                  {choice}
                </span>
              </button>
            ))}
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <input
              value={custom}
              onChange={(e) => setCustom(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault()
                  choose(custom)
                }
                if (e.key === 'Escape') setOpen(false)
              }}
              placeholder="Or paste your own"
              aria-label={`Custom icon for ${label}`}
              maxLength={4}
              className="editable-field px-3 py-2 border border-slate-500 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 max-w-[10rem] text-sm"
            />
            <button
              type="button"
              disabled={saving || !custom.trim()}
              onClick={() => choose(custom)}
              className="editor-chrome px-3 min-h-11 inline-flex items-center bg-slate-900 text-white rounded-full text-xs hover:bg-black disabled:opacity-50 leading-none"
            >
              {saving ? 'Saving…' : 'Use this'}
            </button>
            <button type="button" onClick={() => setOpen(false)} className="editor-chrome px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-xs hover:border-slate-900 leading-none">
              Close
            </button>
          </div>
          {error && <p className="editor-chrome text-[11px] text-red-600">{error}</p>}
        </div>
      )}
    </div>
  )
}
