/**
 * POST /api/admin/upload-image — admin R2 upload
 * Strategy: PNG if ≤1MB (lossless) else WebP compress within 1MB (per user correction)
 * Client does resize to 1200px max + PNG try first, WebP fallback to stay ≤1MB, 0 Worker CPU for resize
 * Server safety net validates size ≤1MB, type image/*, and implements replace-on-update delete old before put new to stay under 10GB free tier
 * 100 images scenario: 100*400KB avg=40MB per env, alpha+prod combined 80-100MB <1% of 10GB (10240MB), capacity 10k images
 * Free tier limits: Browser→Worker 100MB Free (CF edge), Worker→R2 single PUT 5 GiB, our 1MB well below, no nginx client_max_body_size config needed
 * Auth: passwordless Google login via Zero Trust, only allowlisted emails, ADMIN_BYPASS for local
 * Env isolation: alpha bucket portfolio-images-alpha vs prod portfolio-images share account 10GB pool but combined still safe
 */

import { requireAdminAuth, isAdminAuthenticated } from '../../_lib/auth'
import { getEnvironment } from '../../_lib/env'

export interface Env {
  R2_BUCKET?: {
    put: (key: string, body: any, opts?: any) => Promise<any>
    delete: (key: string) => Promise<void>
    get?: any
    list?: any
  }
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

const MAX_FILE_SIZE = 1_048_576 // 1MB
const ALLOWED_MIME_PREFIX = 'image/'
const ALLOWED_MIME_TYPES = ['image/png', 'image/webp', 'image/jpeg', 'image/jpg']

function isValidOldKey(oldKey: string): { valid: boolean; error?: string } {
  if (!oldKey) return { valid: true } // optional
  if (oldKey.includes('..') || oldKey.includes('//') || oldKey.startsWith('/') || oldKey.includes('\\')) {
    return { valid: false, error: 'Invalid oldKey — path traversal detected' }
  }
  if (!oldKey.startsWith('portfolio/')) {
    return { valid: false, error: 'Invalid oldKey — must start with portfolio/' }
  }
  const lower = oldKey.toLowerCase()
  if (!lower.endsWith('.png') && !lower.endsWith('.webp') && !lower.endsWith('.jpg') && !lower.endsWith('.jpeg')) {
    return { valid: false, error: 'Invalid oldKey — only .png, .webp, .jpg allowed' }
  }
  return { valid: true }
}

function getExtensionFromMime(mime: string, originalName?: string): string {
  const lowerMime = mime.toLowerCase()
  if (lowerMime === 'image/png') return 'png'
  if (lowerMime === 'image/webp') return 'webp'
  if (lowerMime === 'image/jpeg' || lowerMime === 'image/jpg') return 'jpg'
  // Fallback from original name
  if (originalName) {
    const lowerName = originalName.toLowerCase()
    if (lowerName.endsWith('.webp')) return 'webp'
    if (lowerName.endsWith('.jpg') || lowerName.endsWith('.jpeg')) return 'jpg'
  }
  return 'png' // default per strategy PNG first
}

function generateSafeKey(extension: string): string {
  // UUID v4 — simple random, not crypto secure but enough for free tier
  const uuid = crypto.randomUUID()
  // Sanitize extension
  const ext = extension.replace(/[^a-z0-9]/g, '').toLowerCase() || 'png'
  return `portfolio/${uuid}.${ext}`
}

export const onRequestPost: PagesFunction<Env> = async ({ request, env }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  // Auth check — passwordless Google via Zero Trust, few allowlisted emails
  const authFailure = requireAdminAuth(request, env)
  if (authFailure) {
    console.log(`!!! UPLOAD_IMAGE_AUTH_FAILED status=${authFailure.status} url=${request.url}`)
    return authFailure
  }

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  console.log(`!!! UPLOAD_IMAGE_REQUEST env=${envName} email=${authResult.email} bypass=${authResult.bypass}`)

  const r2 = env?.R2_BUCKET
  if (!r2 || typeof r2.put !== 'function') {
    console.log('!!! UPLOAD_IMAGE_R2_MISSING no binding')
    return new Response(JSON.stringify({ error: 'R2_BUCKET binding missing' }), {
      status: 500,
      headers: commonHeaders,
    })
  }

  let formData: FormData
  try {
    formData = await request.formData()
  } catch (e: any) {
    console.log(`!!! UPLOAD_IMAGE_FORMDATA_ERROR ${e?.message}`)
    return new Response(JSON.stringify({ error: 'Failed to parse multipart form-data — expect file field' }), {
      status: 400,
      headers: commonHeaders,
    })
  }

  const fileEntry = formData.get('file')
  if (!fileEntry) {
    return new Response(JSON.stringify({ error: 'Missing file field — multipart/form-data file required' }), {
      status: 400,
      headers: commonHeaders,
    })
  }

  // fileEntry can be File or string
  const file = fileEntry as File
  if (typeof file === 'string' || !file.type) {
    return new Response(JSON.stringify({ error: 'Invalid file field — must be File' }), {
      status: 400,
      headers: commonHeaders,
    })
  }

  // Validate MIME — image/* only, but prefer PNG if ≤1MB else WebP per strategy
  if (!file.type.startsWith(ALLOWED_MIME_PREFIX)) {
    console.log(`!!! UPLOAD_IMAGE_INVALID_MIME type=${file.type}`)
    return new Response(JSON.stringify({ error: `Invalid file type ${file.type} — only images allowed (image/png, image/webp, image/jpeg)` }), {
      status: 400,
      headers: commonHeaders,
    })
  }

  // Optional: check allowed mime list, but allow image/* with warning
  // We allow image/* but our strategy prefers PNG→WebP
  // If type not in allowed list but still image/*, we allow (e.g. image/gif) but will convert via client

  // Validate size — server safety net, client should have resized PNG if ≤1MB else WebP within 1MB
  if (file.size > MAX_FILE_SIZE) {
    console.log(`!!! UPLOAD_IMAGE_TOO_LARGE size=${file.size} name=${file.name} type=${file.type}`)
    return new Response(
      JSON.stringify({
        error: `File too large ${file.size} bytes > ${MAX_FILE_SIZE} bytes (1MB max). Client should have resized to PNG if ≤1MB else WebP compress within 1MB at 1200px max. Current size ${file.size}. Reduce dimension or quality.`,
        size: file.size,
        maxSize: MAX_FILE_SIZE,
        guidance: 'Client resize: canvas max 1200px, try PNG first if ≤1MB else WebP q0.9→0.5 within 1MB. 100 images ×400KB avg=40MB per env, 80MB combined <1% of 10GB free tier.',
      }),
      {
        status: 400,
        headers: commonHeaders,
      }
    )
  }

  // oldKey handling — replace-on-update to stay under 10GB free tier
  const oldKeyRaw = formData.get('oldKey')
  const oldKey = oldKeyRaw ? String(oldKeyRaw).trim() : ''
  if (oldKey) {
    const validation = isValidOldKey(oldKey)
    if (!validation.valid) {
      console.log(`!!! UPLOAD_IMAGE_INVALID_OLDKEY oldKey=${oldKey} error=${validation.error}`)
      return new Response(JSON.stringify({ error: validation.error }), {
        status: 400,
        headers: commonHeaders,
      })
    }
  }

  const extension = getExtensionFromMime(file.type, file.name)
  const newKey = generateSafeKey(extension)
  const format = extension === 'jpg' ? 'jpeg' : extension // normalize

  // Replace-on-update: delete old before put new to stay under 10GB
  if (oldKey) {
    try {
      console.log(`!!! UPLOAD_IMAGE_DELETE_OLD oldKey=${oldKey} newKey=${newKey}`)
      await r2.delete(oldKey)
      console.log(`!!! UPLOAD_IMAGE_DELETE_OLD_DONE oldKey=${oldKey}`)
    } catch (e: any) {
      console.log(`!!! UPLOAD_IMAGE_DELETE_OLD_ERROR oldKey=${oldKey} error=${e?.message} — continuing with PUT (orphan <1MB acceptable, cleaned via quota endpoint)`)
      // Don't fail upload if delete fails — orphaned file <1MB acceptable, cleaned via R2 usage endpoint
    }
  }

  try {
    console.log(`!!! UPLOAD_IMAGE_PUT_START key=${newKey} size=${file.size} type=${file.type} format=${format} env=${envName} email=${authResult.email}`)
    // file.stream() for R2 put — streaming, not buffered whole file twice
    const putResult = await r2.put(newKey, file.stream(), {
      httpMetadata: {
        contentType: file.type,
        cacheControl: 'public, max-age=31536000, immutable',
      },
      customMetadata: {
        uploadedBy: authResult.email || 'unknown',
        originalName: file.name?.slice(0, 200) || '',
        originalSize: String(file.size),
        format,
        env: envName,
      },
    })
    console.log(`!!! UPLOAD_IMAGE_PUT_DONE key=${newKey} size=${file.size} etag=${(putResult as any)?.etag}`)

    // Return URL via our image serving endpoint /api/images/{key} — public read, no auth needed for visitors
    const url = `/api/images/${newKey}`

    return new Response(
      JSON.stringify({
        key: newKey,
        url,
        size: file.size,
        format,
        contentType: file.type,
        originalName: file.name,
        env: envName,
        uploadedBy: authResult.email,
        strategy: 'PNG if ≤1MB (lossless) else WebP compress within 1MB, max 1200px, oldKey delete-before-put to stay under 10GB free tier for 100 images (80-100MB total <1% of 10GB)',
        limits: {
          browserToWorker: '100MB max request body Free plan (CF edge) — our 1MB well below, no nginx config needed',
          workerToR2Single: '5 GiB max object single PUT — our PNG/WebP ≤1MB safe',
          app: '1MB max',
        },
      }),
      {
        status: 200,
        headers: commonHeaders,
      }
    )
  } catch (e: any) {
    console.log(`!!! UPLOAD_IMAGE_PUT_ERROR key=${newKey} error=${e?.message}`)
    return new Response(JSON.stringify({ error: `Failed to upload image: ${e?.message || String(e)}` }), {
      status: 500,
      headers: commonHeaders,
    })
  }
}
