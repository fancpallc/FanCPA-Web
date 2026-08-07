/**
 * GET /api/images/{key} — public R2 image serving for portfolio images
 * Serves objects from R2_BUCKET with key starting with portfolio/
 * Public read (no auth) so visitors can see portfolio images
 * Free tier safe: single R2 get (Class B), cache 1yr, no LIST
 *
 * Key extraction: parses URL pathname after /api/images/ to support nested keys like portfolio/abc.png
 * Security: rejects path traversal (..), only allows portfolio/ prefix, sanitizes key
 */

export interface Env {
  R2_BUCKET?: {
    get: (key: string) => Promise<{ key: string; size: number; httpMetadata?: { contentType?: string }; body: any; arrayBuffer?: () => Promise<ArrayBuffer> } | null>
  }
  [key: string]: any
}

function extractKeyFromUrl(urlString: string): string | null {
  try {
    const url = new URL(urlString)
    const pathname = url.pathname // e.g. /api/images/portfolio/test.png
    const prefix = '/api/images/'
    if (!pathname.startsWith(prefix)) return null
    let key = pathname.slice(prefix.length) // portfolio/test.png
    // Decode URI
    try {
      key = decodeURIComponent(key)
    } catch {
      // If decode fails, keep raw
    }
    if (!key) return null
    return key
  } catch {
    return null
  }
}

function isValidKey(key: string): { valid: boolean; error?: string } {
  if (!key) return { valid: false, error: 'Missing key' }
  // Reject path traversal
  if (key.includes('..') || key.includes('//') || key.startsWith('/') || key.includes('\\')) {
    return { valid: false, error: 'Invalid key — path traversal detected' }
  }
  // Only allow portfolio/ prefix per our upload strategy (100 images, profile, icons etc)
  if (!key.startsWith('portfolio/')) {
    return { valid: false, error: 'Invalid key — must start with portfolio/' }
  }
  // Validate extension — allow png (lossless) and webp (fallback) + jpg/jpeg for legacy
  const lower = key.toLowerCase()
  if (!lower.endsWith('.png') && !lower.endsWith('.webp') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
    return { valid: false, error: 'Invalid key — only .png, .webp, .jpg allowed' }
  }
  // No control chars
  if (/[\0-\x1F\x7F]/.test(key)) {
    return { valid: false, error: 'Invalid key — control chars' }
  }
  return { valid: true }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = {
    'Access-Control-Allow-Origin': '*',
    'Cache-Control': 'public, max-age=31536000, immutable',
  }

  const key = extractKeyFromUrl(request.url)
  if (!key) {
    return new Response(JSON.stringify({ error: 'Missing image key — use /api/images/portfolio/<file>.png' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json', ...headers, 'Cache-Control': 'no-store' },
    })
  }

  const validation = isValidKey(key)
  if (!validation.valid) {
    console.log(`!!! IMAGES_INVALID_KEY key=${key} error=${validation.error}`)
    return new Response(JSON.stringify({ error: validation.error }), {
      status: 400,
      headers: { 'Content-Type': 'application/json', ...headers, 'Cache-Control': 'no-store' },
    })
  }

  const r2 = env?.R2_BUCKET
  if (!r2 || typeof r2.get !== 'function') {
    console.log('!!! IMAGES_R2_MISSING no binding')
    return new Response(JSON.stringify({ error: 'R2_BUCKET binding missing' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', ...headers, 'Cache-Control': 'no-store' },
    })
  }

  try {
    console.log(`!!! IMAGES_GET_START key=${key}`)
    const obj = await r2.get(key)
    if (!obj) {
      console.log(`!!! IMAGES_GET_MISS key=${key}`)
      return new Response(JSON.stringify({ error: 'Image not found' }), {
        status: 404,
        headers: { 'Content-Type': 'application/json', ...headers, 'Cache-Control': 'no-store' },
      })
    }

    const contentType = obj.httpMetadata?.contentType || (key.endsWith('.webp') ? 'image/webp' : key.endsWith('.png') ? 'image/png' : 'image/jpeg')
    // obj.body can be ReadableStream, Uint8Array, or have arrayBuffer
    let body: any = obj.body
    // If body is Uint8Array, convert to arrayBuffer for Response
    if (body instanceof Uint8Array) {
      body = body.buffer.slice(body.byteOffset, body.byteOffset + body.byteLength)
    }

    console.log(`!!! IMAGES_GET_HIT key=${key} size=${obj.size} ct=${contentType}`)
    return new Response(body, {
      status: 200,
      headers: {
        'Content-Type': contentType,
        'Content-Length': String(obj.size),
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Access-Control-Allow-Origin': '*',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (e: any) {
    console.log(`!!! IMAGES_GET_ERROR key=${key} error=${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to get image: ${e?.message || String(e)}` }), {
      status: 500,
      headers: { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Cache-Control': 'no-store' },
    })
  }
}
