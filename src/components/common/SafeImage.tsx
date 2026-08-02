import React, { useState, useEffect } from 'react'

export interface SafeImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  src: string
  /** Extra classes for the fallback tile, which replaces the image in place. */
  fallbackClassName?: string
}

/**
 * An `<img>` that says so when it cannot load.
 *
 * Image URLs are owner-editable, and a dead one used to render as a silent white
 * hole the size of the image — no border, no message, nothing to tell the owner
 * their link is broken.
 */
export function SafeImage({ src, alt = '', className = '', fallbackClassName = '', ...rest }: SafeImageProps) {
  const [failed, setFailed] = useState(false)

  useEffect(() => {
    setFailed(false)
  }, [src])

  if (failed) {
    return (
      <div
        role="img"
        aria-label={alt ? `${alt} — image unavailable` : 'Image unavailable'}
        className={`flex flex-col items-center justify-center gap-2 bg-slate-50 border border-slate-200 text-gray-500 ${className} ${fallbackClassName}`}
      >
        <svg width="28" height="28" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.25" strokeLinecap="round" strokeLinejoin="round" aria-hidden>
          <rect x="3" y="3" width="18" height="18" rx="2" />
          <circle cx="8.5" cy="8.5" r="1.5" />
          <path d="m21 15-5-5L5 21" />
        </svg>
        <span className="text-xs">Image unavailable</span>
      </div>
    )
  }

  return <img src={src} alt={alt} className={className} onError={() => setFailed(true)} {...rest} />
}
