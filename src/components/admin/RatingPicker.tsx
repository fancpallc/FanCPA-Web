import React, { useState } from 'react'
import { MAX_RATING, normalizeRating } from '../common/StarRating'

export interface RatingPickerProps {
  rating?: number | null
  onSave: (rating: number) => Promise<void> | void
  /** Named in the confirmation and the labels so a page of six pickers stays distinguishable. */
  label?: string
}

/**
 * The star row on a testimonial was five hardcoded characters, so a four-star client
 * was published as a five-star one and the owner had no control over it. Each star is
 * its own button, which makes the control keyboard-reachable without a custom widget.
 */
export function RatingPicker({ rating, onSave, label = 'this testimonial' }: RatingPickerProps) {
  const current = normalizeRating(rating)
  const [hovered, setHovered] = useState<number | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedJustNow, setSavedJustNow] = useState(false)

  // While the pointer is over the row, show what clicking would give you rather than
  // what is stored — otherwise picking a lower rating gives no feedback until it saves.
  const shown = hovered ?? current

  const pick = async (value: number) => {
    if (value === current) return
    setSaving(true)
    setError(null)
    try {
      await onSave(value)
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
    } catch (e: any) {
      setError(e?.message || String(e))
    } finally {
      setSaving(false)
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      <div className="flex items-center gap-0.5" onMouseLeave={() => setHovered(null)}>
        {Array.from({ length: MAX_RATING }).map((_, i) => {
          const value = i + 1
          return (
            <button
              key={value}
              type="button"
              disabled={saving}
              aria-label={`Rate ${label} ${value} out of ${MAX_RATING} stars`}
              aria-pressed={value === current}
              onMouseEnter={() => setHovered(value)}
              onFocus={() => setHovered(value)}
              onBlur={() => setHovered(null)}
              onClick={() => pick(value)}
              className={`w-11 min-h-11 inline-flex items-center justify-center rounded-lg text-lg leading-none hover:bg-amber-50 disabled:opacity-50 ${
                value <= shown ? 'text-amber-400' : 'text-slate-300'
              }`}
            >
              <span aria-hidden>{value <= shown ? '★' : '☆'}</span>
            </button>
          )
        })}
      </div>
      <span className="editor-chrome text-[11px] text-gray-500">
        {current} of {MAX_RATING} stars
      </span>
      <div aria-live="polite" aria-atomic="true">
        {savedJustNow && (
          <span className="editor-chrome text-[11px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full" role="status">
            Saved ✓
          </span>
        )}
      </div>
      {error && <span className="editor-chrome text-[11px] text-red-600">{error}</span>}
    </div>
  )
}
