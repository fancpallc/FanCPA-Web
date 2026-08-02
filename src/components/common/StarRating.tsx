import React from 'react'

export const MAX_RATING = 5

/**
 * Testimonials shipped with `rating` NULL, and the renderer drew five stars regardless.
 * NULL therefore has to keep meaning five, or every existing quote would lose its stars
 * the moment ratings became real.
 */
export function normalizeRating(value: number | null | undefined): number {
  if (value === null || value === undefined) return MAX_RATING
  const n = Math.round(Number(value))
  if (!Number.isFinite(n)) return MAX_RATING
  return Math.min(MAX_RATING, Math.max(1, n))
}

export interface StarRatingProps {
  rating?: number | null
  className?: string
}

export function StarRating({ rating, className = '' }: StarRatingProps) {
  const value = normalizeRating(rating)
  return (
    <div className={`flex gap-1 ${className}`} role="img" aria-label={`Rated ${value} out of ${MAX_RATING}`}>
      {Array.from({ length: MAX_RATING }).map((_, i) => (
        // Unearned stars stay in place as outlines rather than disappearing: a lone
        // three-star row reads as a rendering failure, three-of-five reads as a rating.
        <span key={i} className={i < value ? 'text-amber-400 text-sm' : 'text-slate-300 text-sm'} aria-hidden>
          {i < value ? '★' : '☆'}
        </span>
      ))}
    </div>
  )
}
