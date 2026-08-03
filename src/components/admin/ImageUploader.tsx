import React, { useState, useRef, useEffect, useId } from 'react'
import { resizeImage, isImageFile, MAX_FILE_SIZE, MAX_DIMENSION } from '../../lib/imageResize'
import { SafeImage } from '../common/SafeImage'
import { debug } from '../../lib/debug'

export interface ImageUploaderProps {
  currentImageUrl?: string
  oldKey?: string
  /** Explicit id for the file input so an outside element can trigger it via label/getElementById */
  inputId?: string
  /** 'card' = compact thumbnail row, 'hero' = large 4:3 preview. Both render exactly one upload control. */
  variant?: 'card' | 'hero'
  /** What this image is, for the control's accessible name — e.g. "hero", "gallery item 3". */
  label?: string
  /** May be async — the uploader only reports success once this resolves, so a failed
   *  DB save is never shown as "Uploaded ✓". */
  onUploadComplete: (result: { url: string; key: string; size: number; format: string }) => void | Promise<void>
  onError?: (error: string) => void
}

/**
 * Smallest width worth accepting per slot, roughly the CSS width each renders at on a
 * 1440px screen. Anything narrower is upscaled by `object-cover` and looks broken.
 */
export const MIN_WIDTH_BY_VARIANT: Record<'card' | 'hero', number> = { card: 320, hero: 640 }

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`
}

export function ImageUploader({
  currentImageUrl,
  oldKey,
  inputId,
  variant = 'card',
  label,
  onUploadComplete,
  onError,
}: ImageUploaderProps) {
  const [uploading, setUploading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [previewUrl, setPreviewUrl] = useState<string | null>(currentImageUrl || null)
  const [lastResult, setLastResult] = useState<{ size: number; format: string; width: number; height: number } | null>(null)
  const [justUploaded, setJustUploaded] = useState(false)
  const inputRef = useRef<HTMLInputElement>(null)
  const [dragOver, setDragOver] = useState(false)
  const generatedId = useId()
  const fileInputId = inputId || `image-upload-${generatedId}`

  // Keep preview in sync when currentImageUrl prop changes after upload refetch — fixes stale thumb
  useEffect(() => {
    setPreviewUrl(currentImageUrl || null)
  }, [currentImageUrl])

  // Revoke object URLs to avoid memory leak
  useEffect(() => {
    return () => {
      if (previewUrl && previewUrl.startsWith('blob:')) {
        try { URL.revokeObjectURL(previewUrl) } catch {}
      }
    }
  }, [previewUrl])

  const openPicker = () => {
    if (uploading) return
    inputRef.current?.click()
  }

  const processFile = async (file: File) => {
    setError(null)
    setJustUploaded(false)

    if (!isImageFile(file)) {
      const msg = "That file isn't an image — please choose a JPG, PNG or WebP."
      setError(msg)
      onError?.(msg)
      debug(`!!! IMAGE_UPLOADER_INVALID_TYPE type=${file.type}`)
      return
    }

    try {
      setUploading(true)
      debug(`!!! IMAGE_UPLOADER_START name=${file.name} size=${file.size} type=${file.type}`)

      const resized = await resizeImage(file, MAX_DIMENSION, MAX_FILE_SIZE)

      debug(`!!! IMAGE_UPLOADER_RESIZED orig=${resized.originalSize} final=${resized.finalSize} format=${resized.format} ${resized.width}x${resized.height} q=${resized.quality}`)

      // An 8x8 favicon uploaded into the hero slot was accepted silently, and `object-cover`
      // blew its 64 pixels up to roughly 720x540 — the page's first impression was a solid
      // colour block that looked like a rendering failure. Refuse before it reaches R2:
      // the upload cannot be undone from the owner's side without another upload.
      const minWidth = MIN_WIDTH_BY_VARIANT[variant]
      if (resized.width < minWidth) {
        const msg = `That image is only ${resized.width}px wide. It would look blurry or blocky at the size this slot displays — please pick one at least ${minWidth}px wide.`
        setError(msg)
        onError?.(msg)
        debug(`!!! IMAGE_UPLOADER_TOO_SMALL ${resized.width}x${resized.height} min=${minWidth}`)
        return
      }

      // Optimistic local preview — revoke previous blob URL to avoid leak
      try {
        if (previewUrl && previewUrl.startsWith('blob:')) {
          try { URL.revokeObjectURL(previewUrl) } catch {}
        }
        if (typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
          setPreviewUrl(URL.createObjectURL(resized.blob))
        }
      } catch {
        // ignore in test env
      }

      if (resized.finalSize > MAX_FILE_SIZE) {
        const msg = `Image is still ${formatBytes(resized.finalSize)} after optimizing — please pick a smaller image`
        setError(msg)
        onError?.(msg)
        return
      }

      const formData = new FormData()
      formData.append('file', resized.blob, `resized.${resized.format}`)
      if (oldKey) formData.append('oldKey', oldKey)

      debug(`!!! IMAGE_UPLOADER_UPLOAD_START key=${oldKey || 'new'} format=${resized.format} size=${resized.finalSize}`)

      const response = await fetch('/api/admin/upload-image', { method: 'POST', body: formData, credentials: 'same-origin' })

      if (!response.ok) {
        const errJson = (await response.json().catch(() => ({ error: response.statusText }))) as any
        throw new Error(errJson?.error || `Upload failed ${response.status}`)
      }

      const result = (await response.json()) as any
      debug(`!!! IMAGE_UPLOADER_UPLOAD_DONE key=${result.key} url=${result.url}`)

      setPreviewUrl(result.url)
      setLastResult({ size: result.size, format: result.format, width: resized.width, height: resized.height })

      // Only claim success once the caller has persisted the new URL.
      await onUploadComplete(result)
      setJustUploaded(true)
      if (inputRef.current) inputRef.current.value = ''
    } catch (err: any) {
      const msg = err?.message || String(err)
      setError(msg)
      onError?.(msg)
      debug(`!!! IMAGE_UPLOADER_ERROR ${msg}`)
    } finally {
      setUploading(false)
    }
  }

  const handleFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (file) await processFile(file)
  }

  const handleDrop = async (e: React.DragEvent) => {
    e.preventDefault()
    setDragOver(false)
    const file = e.dataTransfer.files?.[0]
    if (file) await processFile(file)
  }

  const dragProps = {
    onDragOver: (e: React.DragEvent) => {
      e.preventDefault()
      setDragOver(true)
    },
    onDragLeave: () => setDragOver(false),
    onDrop: handleDrop,
  }

  const displayUrl = previewUrl || currentImageUrl || null
  const hasImage = Boolean(displayUrl)
  const buttonLabel = label || (hasImage ? 'Replace image' : 'Upload image')

  // Visually hidden but still clickable/focusable — `display:none` inputs refuse to open the
  // file picker in Safari, which is why the button appeared dead.
  const fileInput = (
    <input
      ref={inputRef}
      id={fileInputId}
      type="file"
      accept="image/*"
      onChange={handleFileChange}
      disabled={uploading}
      className="sr-only"
      tabIndex={-1}
    />
  )

  const uploadButton = (
    <button
      type="button"
      onClick={openPicker}
      disabled={uploading}
      className="px-3.5 min-h-11 bg-slate-900 text-white rounded-full text-xs font-semibold hover:bg-black disabled:opacity-50 disabled:cursor-not-allowed inline-flex items-center justify-center gap-1.5 shrink-0"
    >
      {uploading ? (
        <>
          <span className="w-3 h-3 border-2 border-white/40 border-t-white rounded-full animate-spin" aria-hidden />
          Uploading…
        </>
      ) : (
        <>
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
            <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4" />
            <polyline points="17 8 12 3 7 8" />
            <line x1="12" y1="3" x2="12" y2="15" />
          </svg>
          {buttonLabel}
        </>
      )}
    </button>
  )

  const statusLine = error ? (
    <div className="text-[11px] text-red-700 bg-red-50 px-2.5 py-1.5 rounded-lg border border-red-200" role="alert">
      {error}
    </div>
  ) : justUploaded && lastResult ? (
    <div className="text-[11px] text-green-700" role="status">
      Uploaded ✓
    </div>
  ) : null

  if (variant === 'hero') {
    return (
      <div className="flex flex-col gap-2">
        {fileInput}
        <div
          {...dragProps}
          onClick={openPicker}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault()
              openPicker()
            }
          }}
          role="button"
          tabIndex={0}
          aria-label={`${hasImage ? 'Replace' : 'Upload'} ${label || 'hero'} image`}
          aria-busy={uploading}
          className={`relative block w-full aspect-[4/3] rounded-2xl overflow-hidden group cursor-pointer transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-900 focus-visible:ring-offset-2 ${
            hasImage ? 'shadow-lg' : 'border-2 border-dashed border-slate-300 bg-slate-50 hover:border-slate-900 hover:bg-slate-100'
          } ${dragOver ? 'ring-2 ring-slate-900 ring-offset-2' : ''} ${uploading ? 'opacity-60' : ''}`}
        >
          {hasImage ? (
            <SafeImage src={displayUrl!} alt={`${label || 'Hero'} image — click to replace`} className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <div className="w-full h-full flex flex-col items-center justify-center gap-2 text-gray-500 px-6 text-center">
              <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
              <span className="text-sm font-semibold text-slate-700">Add {label ? `a ${label} image` : 'a hero image'}</span>
              <span className="text-xs">Click to choose a file, or drag one here</span>
            </div>
          )}
          {hasImage && (
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/35 transition-colors flex items-center justify-center pointer-events-none">
              {/* A resting badge in the corner, not just a hover overlay: with an image
                  already in place the tile looked like a plain picture, so nothing told
                  the owner it could be replaced until they happened to mouse over it. */}
              <span className="absolute top-3 right-3 px-2.5 py-1 rounded-full bg-white/80 text-slate-900 text-[11px] font-semibold shadow-sm group-hover:opacity-0 transition-opacity inline-flex items-center gap-1">
                <span aria-hidden>✎</span> Replace
              </span>
              <span className="px-3 py-1.5 rounded-full bg-white text-slate-900 text-xs font-semibold opacity-0 group-hover:opacity-100 transition-opacity">
                Click or drop to replace
              </span>
            </div>
          )}
          {uploading && (
            <div className="absolute inset-0 flex items-center justify-center bg-white/60">
              <span className="w-6 h-6 border-2 border-slate-300 border-t-slate-900 rounded-full animate-spin" aria-hidden />
            </div>
          )}
        </div>
        {statusLine}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      {fileInput}
      <div
        {...dragProps}
        title="Drag an image here, or use the button"
        className={`border-2 border-dashed rounded-xl p-2 flex flex-wrap gap-2 items-center transition-colors w-fit max-w-full ${
          dragOver ? 'border-slate-900 bg-slate-50' : 'border-slate-500'
        } ${uploading ? 'opacity-60' : ''}`}
      >
        {/* Preview only — the button below is the single upload control, so screen
            readers and keyboard users get one target instead of two. */}
        <div className="w-12 h-12 rounded-lg border overflow-hidden shrink-0" aria-hidden>
          {hasImage ? (
            <SafeImage src={displayUrl!} alt="" className="w-full h-full object-cover" loading="lazy" />
          ) : (
            <span className="w-full h-full flex items-center justify-center bg-slate-50 text-gray-400">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="3" width="18" height="18" rx="2" />
                <circle cx="8.5" cy="8.5" r="1.5" />
                <path d="m21 15-5-5L5 21" />
              </svg>
            </span>
          )}
        </div>
        {uploadButton}
        {uploading && <span className="text-[11px] text-gray-500">Optimizing…</span>}
      </div>
      {statusLine}
    </div>
  )
}
