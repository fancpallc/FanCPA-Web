import { isAdminAuthenticated, requireAdminAuth, isAdminBypass, getAdminAllowlist } from '../../_lib/auth'
import { getEnvironment } from '../../_lib/env'

export interface Env {
  DB?: any
  R2_BUCKET?: {
    list: (opts?: any) => Promise<{ objects: { key: string; size: number; uploaded?: string }[]; truncated?: boolean; delimitedPrefixes?: string[] }>
    put?: any
    get?: any
    delete?: any
  }
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  [key: string]: any
}

const R2_FREE_LIMIT_BYTES = 10 * 1024 * 1024 * 1024 // 10GB
const R2_FREE_LIMIT_MB = 10240
const WARNING_PERCENT = 90
const WARNING_OBJECTS_COUNT = 9000 // near 10k capacity (10GB/1MB)

function parseCheckQuota(urlString: string): boolean {
  try {
    const url = new URL(urlString)
    const raw = url.searchParams.get('checkQuota') || url.searchParams.get('check_quota') || url.searchParams.get('quota')
    if (!raw) return false
    const lower = raw.toLowerCase()
    return ['true', '1', 'yes', 'on'].includes(lower)
  } catch {
    return false
  }
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const commonHeaders = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  // Auth check — Google login only via Zero Trust, few allowlisted emails
  const authFailure = requireAdminAuth(request, env)
  if (authFailure) {
    console.log(`!!! R2_USAGE_AUTH_FAILED status=${authFailure.status} url=${request.url}`)
    return authFailure
  }

  const authResult = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)
  const checkQuota = parseCheckQuota(request.url)
  const allowlist = getAdminAllowlist(env)

  console.log(`!!! R2_USAGE_REQUEST env=${envName} checkQuota=${checkQuota} email=${authResult.email} bypass=${authResult.bypass}`)

  // Upload limits — researched from https://developers.cloudflare.com/workers/platform/limits/
  const limits = {
    browserToWorker: '100MB max request body on Free plan (Cloudflare Free/Pro) — 200MB Business, 500MB Enterprise — returns 413 if exceeded. Our app enforces 1MB far below.',
    workerToR2Single: '5 GiB max object size single PUT, 5 TiB multipart (up to 10k parts 5MiB-5GiB each) — our PNG ≤1MB safe.',
    workersCPU: '10ms free tier per request (Paid 30s default, 5min max), 128MB memory — client resize keeps CPU <5ms',
    r2FreeStorage: '10GB storage free tier, 10M reads, 1M writes/deletes per month — replace-on-update prevents bloat',
    app: '1MB max image, PNG lossless preferred (not WebP lossy), max 1200px dimension, oldKey deleted before new PUT',
  }

  // Cheap path — no R2 LIST to avoid extra CPU/subrequest when not explicitly requested (free tier safety)
  if (!checkQuota) {
    console.log('!!! R2_USAGE_CHEAP_PATH no LIST — returning placeholder without R2 call to save CPU')
    return new Response(
      JSON.stringify({
        checkQuota: false,
        authed: true,
        email: authResult.email,
        bypass: !!authResult.bypass,
        env: envName,
        totalObjects: 0,
        totalBytes: 0,
        totalMB: 0,
        percent: 0,
        limitMB: R2_FREE_LIMIT_MB,
        limitBytes: R2_FREE_LIMIT_BYTES,
        warning: false,
        truncated: false,
        allowlistConfigured: allowlist.length > 0,
        limits,
        strategy:
          'Client resize PNG lossless max 1200px ≤1MB (0 Worker CPU) → server validates size/type 1MB → R2 put key portfolio/<uuid>.png → if oldKey provided delete old before PUT (replace-on-update) to stay under 10GB. Quota check only on demand via ?checkQuota=true to avoid LIST CPU on every request.',
        guidance: 'Pass ?checkQuota=true to run R2_BUCKET.list() and get real usage. Cheap path used for free tier CPU saving.',
        objects: [],
      }),
      { status: 200, headers: commonHeaders }
    )
  }

  // Expensive path — on demand quota check via R2 LIST (per your request)
  const r2 = env?.R2_BUCKET
  if (!r2 || typeof r2.list !== 'function') {
    console.log('!!! R2_USAGE_R2_MISSING no binding')
    return new Response(
      JSON.stringify({
        checkQuota: true,
        authed: true,
        email: authResult.email,
        env: envName,
        error: 'R2_BUCKET binding missing — cannot list objects',
        totalObjects: 0,
        totalBytes: 0,
        totalMB: 0,
        percent: 0,
        limitMB: R2_FREE_LIMIT_MB,
        limitBytes: R2_FREE_LIMIT_BYTES,
        warning: false,
        truncated: false,
        limits,
        guidance: 'Ensure R2 binding portfolio-images(-alpha) configured in wrangler.toml + Dashboard',
      }),
      { status: 200, headers: commonHeaders } // 200 not 500 — diagnostics
    )
  }

  try {
    console.log('!!! R2_USAGE_LIST_START prefix=portfolio/ limit=1000')
    const start = Date.now()
    const result = await r2.list({ prefix: 'portfolio/', limit: 1000 })
    const ms = Date.now() - start
    const objects = result.objects || []
    const totalBytes = objects.reduce((sum: number, obj: any) => sum + (obj.size || 0), 0)
    const totalMB = totalBytes / (1024 * 1024)
    const percent = (totalBytes / R2_FREE_LIMIT_BYTES) * 100
    const truncated = !!result.truncated
    const warning = percent > WARNING_PERCENT || totalObjectsExceeds(objects.length) || totalBytes > WARNING_PERCENT * 0.01 * R2_FREE_LIMIT_BYTES

    console.log(`!!! R2_USAGE_LIST_DONE count=${objects.length} bytes=${totalBytes} ms=${ms} truncated=${truncated} warning=${warning}`)

    return new Response(
      JSON.stringify({
        checkQuota: true,
        authed: true,
        email: authResult.email,
        bypass: !!authResult.bypass,
        env: envName,
        totalObjects: objects.length,
        totalBytes,
        totalMB: Number(totalMB.toFixed(2)),
        percent: Number(percent.toFixed(3)),
        limitMB: R2_FREE_LIMIT_MB,
        limitBytes: R2_FREE_LIMIT_BYTES,
        warning,
        truncated,
        r2Ms: ms,
        allowlistConfigured: allowlist.length > 0,
        limits,
        strategy:
          'Replace-on-update: delete oldKey before PUT new to stay under 10GB free tier. PNG lossless max 1200px ≤1MB client resize, server validates.',
        guidance: warning
          ? `Storage ${percent.toFixed(1)}% of 10GB free tier — ${totalMB.toFixed(1)}MB used, ${objects.length} objects. Delete unused images or use replace flow (oldKey) to prevent bloat. Portfolio estimate <50 images ~15MB, so safe unless many orphaned.`
          : `Free tier safe: ${totalMB.toFixed(2)}MB / ${R2_FREE_LIMIT_MB}MB (${percent.toFixed(3)}% of 10GB) — ${objects.length} objects. Capacity ~10k images at 1MB each. No action needed.`,
        objects: objects.slice(0, 100).map((o: any) => ({ key: o.key, size: o.size, sizeKB: Math.round((o.size / 1024) * 10) / 10 })),
      }),
      { status: 200, headers: commonHeaders }
    )
  } catch (e: any) {
    console.log(`!!! R2_USAGE_LIST_ERROR ${e?.message}`)
    return new Response(
      JSON.stringify({
        checkQuota: true,
        authed: true,
        email: authResult.email,
        env: envName,
        error: `Failed to list R2 objects: ${e?.message || String(e)}`,
        totalObjects: 0,
        totalBytes: 0,
        totalMB: 0,
        percent: 0,
        limitMB: R2_FREE_LIMIT_MB,
        limitBytes: R2_FREE_LIMIT_BYTES,
        warning: false,
        truncated: false,
        limits,
        guidance: 'Check R2 binding and permissions, ensure bucket exists',
      }),
      { status: 500, headers: commonHeaders }
    )
  }
}

function totalObjectsExceeds(count: number): boolean {
  return count >= WARNING_OBJECTS_COUNT
}
