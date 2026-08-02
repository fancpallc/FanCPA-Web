import React, { useState, useEffect, useRef } from 'react'
import { debug } from '../../lib/debug'

export interface EditableTextProps {
  value: string
  onSave: (newValue: string) => Promise<void> | void
  placeholder?: string
  required?: boolean
  multiline?: boolean
  className?: string
  displayClassName?: string
  inputClassName?: string
  ariaLabel?: string
}

export function EditableText({
  value,
  onSave,
  placeholder = 'Click to edit',
  required = false,
  multiline = false,
  className = '',
  displayClassName = '',
  inputClassName = '',
  ariaLabel,
}: EditableTextProps) {
  const [editing, setEditing] = useState(false)
  const [draft, setDraft] = useState(value)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [savedJustNow, setSavedJustNow] = useState(false)
  const inputRef = useRef<HTMLTextAreaElement>(null)

  // The field is always a textarea so it can grow to fit the text at its rendered
  // size — a one-line <input> at 56px silently scrolled the heading out of view.
  const autoGrow = () => {
    const el = inputRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }

  useEffect(() => {
    setDraft(value)
  }, [value])

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus()
      inputRef.current.select()
      autoGrow()
    }
  }, [editing])

  const startEdit = () => {
    setDraft(value)
    setError(null)
    setSavedJustNow(false)
    setEditing(true)
    if (import.meta.env.DEV) debug('!!! EDITABLE_TEXT_START_EDIT value=' + value.slice(0, 100))
  }

  const cancel = () => {
    setDraft(value)
    setError(null)
    setEditing(false)
    if (import.meta.env.DEV) debug('!!! EDITABLE_TEXT_CANCEL')
  }

  const save = async () => {
    const trimmed = draft.trim()
    if (required && !trimmed) {
      setError('Value required')
      return
    }
    if (trimmed === value.trim()) {
      setEditing(false)
      return
    }
    setSaving(true)
    setError(null)
    try {
      await onSave(trimmed)
      if (import.meta.env.DEV) debug(`!!! EDITABLE_TEXT_SAVED from="${value}" to="${trimmed}"`)
      setEditing(false)
      setSavedJustNow(true)
      setTimeout(() => setSavedJustNow(false), 2000)
    } catch (e: any) {
      setError(e?.message || String(e))
      if (import.meta.env.DEV) debug(`!!! EDITABLE_TEXT_SAVE_ERROR ${e?.message}`)
    } finally {
      setSaving(false)
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !multiline) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Enter' && multiline && (e.ctrlKey || e.metaKey)) {
      e.preventDefault()
      save()
    }
    if (e.key === 'Escape') {
      cancel()
    }
  }

  if (editing) {
    return (
      <div className={`flex flex-col gap-2 w-full ${className}`}>
        <textarea
          ref={inputRef}
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value)
            autoGrow()
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          aria-label={ariaLabel || placeholder}
          // min-h-11 floors the field at 44px on a phone; autoGrow still sets an
          // inline height above that for longer text.
          className={`editable-field px-3 py-2 min-h-11 border border-slate-500 rounded-xl bg-white text-slate-900 focus:outline-none focus:ring-2 focus:ring-slate-900 focus:border-slate-900 w-full block resize-none overflow-hidden ${inputClassName || 'text-sm'}`}
          rows={multiline ? 3 : 1}
          disabled={saving}
        />
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={save}
            disabled={saving}
            aria-label="Save"
            className="editor-chrome px-3 min-h-11 inline-flex items-center bg-slate-900 text-white rounded-full text-xs hover:bg-black disabled:opacity-50 leading-none"
          >
            {saving ? 'Saving…' : 'Save'}
          </button>
          {/* border-slate-500, not the --border hairline: a white pill on a white card
              bounded at 1.2:1 was invisible as a control next to the filled Save. */}
          <button onClick={cancel} disabled={saving} aria-label="Cancel" className="editor-chrome px-3 min-h-11 inline-flex items-center bg-white border border-slate-500 rounded-full text-xs hover:border-slate-900 leading-none">
            Cancel
          </button>
          <span className="editor-chrome text-[11px] text-gray-400">{multiline ? 'Ctrl+Enter' : 'Enter'} to save · Esc to cancel</span>
          {error && <span className="editor-chrome text-[11px] text-red-600 ml-2">{error}</span>}
        </div>
      </div>
    )
  }

  return (
    <div className={`group flex items-start gap-2 ${className}`}>
      <button
        onClick={startEdit}
        aria-label={ariaLabel ? `Edit ${ariaLabel}` : `Edit ${placeholder}`}
        // The hover affordance is a border in the inherited text colour, not a light
        // fill: a fixed light fill made white headings invisible on the dark CTA banner.
        // min-h-11, not min-h-8: this is the entry point to every one of the ~38
        // editable fields, and at 32px it was the last thing in the admin under the
        // 44px touch-target floor.
        className={`text-left p-1 -m-1 rounded-xl border border-dashed border-transparent hover:border-current transition-colors flex items-start gap-2 min-h-11 ${displayClassName}`}
      >
        <span className={displayClassName}>{value || <span className="text-gray-400 italic">{placeholder}</span>}</span>
        {/* Inherits the surrounding text colour so the hint stays legible on the
            dark CTA banner as well as on white cards. */}
        {/* Always visible below `sm`: a phone has no hover, so an opacity-0 hint left the
            whole admin looking like read-only text. On desktop it rests at 40% rather
            than 0 for the same reason — a field you have to hover to discover is a
            field a first-time owner never finds — and rises to 70% on hover. */}
        <span className="editor-chrome text-[11px] opacity-70 sm:opacity-40 group-hover:opacity-70 transition-opacity mt-0.5 shrink-0" aria-hidden>
          ✎ Edit
        </span>
      </button>
      <div aria-live="polite" aria-atomic="true">
        {savedJustNow && <span className="editor-chrome text-[11px] text-green-700 bg-green-50 border border-green-200 px-2 py-0.5 rounded-full" role="status">Saved ✓</span>}
      </div>
    </div>
  )
}
