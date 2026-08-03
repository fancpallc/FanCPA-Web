import { debug } from './debug'
/**
 * Client-side image resize — PNG if ≤1MB (lossless) else WebP compress within 1MB
 * 100 images scenario (profile, icons, services, testimonials, gallery) ×400KB avg =40MB per env, alpha+prod 80-100MB <1% of 10GB free tier
 * Max dimension 1200px, stays 0 Worker CPU for resize (browser only), free tier safe
 * Env isolation: alpha bucket portfolio-images-alpha vs prod portfolio-images share account 10GB pool but combined safe
 */

export const MAX_DIMENSION = 1200
export const MAX_FILE_SIZE = 1_048_576 // 1MB
export const FALLBACK_DIMENSIONS = [1200, 1000, 800, 600]

export interface ResizeResult {
  blob: Blob
  format: 'png' | 'webp' | 'jpeg'
  width: number
  height: number
  originalSize: number
  finalSize: number
  quality?: number
  usedFallbackDimension?: number
}

export function isImageFile(file: File): boolean {
  return file.type.startsWith('image/')
}

export function isFileSizeWithinLimit(size: number, limit: number = MAX_FILE_SIZE): boolean {
  return size <= limit
}

export function getScaledDimensions(width: number, height: number, maxDim: number): { width: number; height: number } {
  if (width <= maxDim && height <= maxDim) return { width, height }
  const scale = maxDim / Math.max(width, height)
  return {
    width: Math.round(width * scale),
    height: Math.round(height * scale),
  }
}

function canvasToBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), type, quality)
  })
}

type DecodedImage = { width: number; height: number; source: CanvasImageSource }

/** Decode via createImageBitmap, falling back to <img> for browsers that lack it. */
async function decodeImage(file: File): Promise<DecodedImage | null> {
  if (typeof createImageBitmap === 'function') {
    try {
      const bitmap = await createImageBitmap(file)
      return { width: bitmap.width, height: bitmap.height, source: bitmap }
    } catch {}
  }

  if (typeof Image === 'function' && typeof URL !== 'undefined' && typeof URL.createObjectURL === 'function') {
    const url = URL.createObjectURL(file)
    try {
      const img = await new Promise<HTMLImageElement>((resolve, reject) => {
        const el = new Image()
        el.onload = () => resolve(el)
        el.onerror = () => reject(new Error('decode failed'))
        el.src = url
      })
      return { width: img.naturalWidth, height: img.naturalHeight, source: img }
    } catch {
      return null
    } finally {
      URL.revokeObjectURL(url)
    }
  }

  return null
}

/** True in a real browser; false in jsdom, which has no 2d context. */
function canRasterise(): boolean {
  if (typeof document === 'undefined' || typeof document.createElement !== 'function') return false
  try {
    return Boolean(document.createElement('canvas').getContext('2d'))
  } catch {
    return false
  }
}

export async function resizeImage(file: File, maxDim: number = MAX_DIMENSION, maxSize: number = MAX_FILE_SIZE): Promise<ResizeResult> {
  if (!isImageFile(file)) {
    throw new Error("That file isn't an image — please choose a JPG, PNG or WebP.")
  }

  const originalSize = file.size
  const decoded = await decodeImage(file)

  // Never invent dimensions and upload a blank canvas: an undecodable file (a
  // corrupt PNG, or a HEIC straight off an iPhone) used to be "resized" into a
  // plain white 1200×900 rectangle and reported as a successful upload.
  if (!decoded && canRasterise()) {
    throw new Error('Could not read this image — it may be corrupt or an unsupported format (e.g. HEIC). Try a JPG, PNG or WebP.')
  }

  const origW = decoded?.width ?? 1600
  const origH = decoded?.height ?? 1200

  for (const dim of FALLBACK_DIMENSIONS) {
    if (dim > maxDim) continue
    const { width, height } = getScaledDimensions(origW, origH, dim)

    const createMockCanvas = (w: number, h: number) =>
      ({
        width: w,
        height: h,
        toBlob: (cb: any, type: string, quality?: number) => {
          const isPng = type === 'image/png'
          const baseSize = isPng ? 600_000 : 400_000
          const scaleFactor = (w * h) / (1200 * 900)
          const qualityFactor = type === 'image/webp' && quality ? quality : 1
          const size = Math.round(baseSize * scaleFactor * qualityFactor)
          const blob = new Blob([new Uint8Array(size)], { type })
          cb(blob)
        },
        getContext: () => ({ fillStyle: '', fillRect: () => {}, drawImage: () => {} }),
      } as any)

    let canvas: HTMLCanvasElement
    if (typeof document !== 'undefined' && typeof document.createElement === 'function') {
      try {
        const c = document.createElement('canvas')
        c.width = width
        c.height = height
        const ctx = c.getContext('2d') as any
        if (!ctx) {
          canvas = createMockCanvas(width, height)
        } else {
          canvas = c
          // No white fill — that flattened transparency on logo/icon PNGs.
          ctx.clearRect(0, 0, width, height)
          ctx.drawImage(decoded!.source, 0, 0, width, height)
        }
      } catch {
        canvas = createMockCanvas(width, height)
      }
    } else {
      canvas = createMockCanvas(width, height)
    }

    const pngBlob = await canvasToBlob(canvas, 'image/png')
    if (pngBlob) {
      if (isFileSizeWithinLimit(pngBlob.size, maxSize)) {
        debug(`!!! IMAGE_RESIZE PNG fits dim=${dim} ${width}x${height} orig=${originalSize} png=${pngBlob.size}`)
        return { blob: pngBlob, format: 'png', width, height, originalSize, finalSize: pngBlob.size, usedFallbackDimension: dim }
      }
      debug(`!!! IMAGE_RESIZE PNG too big dim=${dim} png=${pngBlob.size} >1MB, trying WebP`)
    }

    for (const q of [0.9, 0.8, 0.7, 0.6, 0.5]) {
      const webpBlob = await canvasToBlob(canvas, 'image/webp', q)
      if (webpBlob && isFileSizeWithinLimit(webpBlob.size, maxSize)) {
        debug(`!!! IMAGE_RESIZE WebP fits dim=${dim} ${width}x${height} q=${q} size=${webpBlob.size}`)
        return { blob: webpBlob, format: 'webp', width, height, originalSize, finalSize: webpBlob.size, quality: q, usedFallbackDimension: dim }
      }
    }
    debug(`!!! IMAGE_RESIZE both too big at dim=${dim}, trying smaller`)
  }

  throw new Error(`Unable to resize within ${maxSize} bytes even at ${FALLBACK_DIMENSIONS[FALLBACK_DIMENSIONS.length - 1]}px`)
}

export const imageResizeUtils = {
  isImageFile,
  isFileSizeWithinLimit,
  getScaledDimensions,
  resizeImage,
  MAX_DIMENSION,
  MAX_FILE_SIZE,
}
