import { isAdminAuthenticated, isAdminBypass, getAdminAllowlist } from '../../_lib/auth'
import { getEnvironment } from '../../_lib/env'

export interface Env {
  ENVIRONMENT?: string
  ADMIN_BYPASS?: string
  ADMIN_EMAILS?: string
  ADMIN_EMAIL?: string
  [key: string]: any
}

export const onRequestGet: PagesFunction<Env> = async ({ request, env }) => {
  const headers = {
    'Content-Type': 'application/json',
    'Cache-Control': 'no-store',
    'Access-Control-Allow-Origin': '*',
  }

  const result = isAdminAuthenticated(request, env)
  const envName = getEnvironment(env as any)

  if (!result.authed) {
    const isForbidden = result.error?.toLowerCase().includes('not allowed') || result.error?.toLowerCase().includes('allowlist')
    const status = isForbidden ? 403 : 401
    console.log(`!!! ADMIN_AUTH_CHECK failed status=${status} email=${result.email || 'none'} error=${result.error} env=${envName} bypassAttempt=${isAdminBypass(env)}`)
    return new Response(
      JSON.stringify({
        authed: false,
        email: result.email || null,
        bypass: false,
        env: envName,
        error: result.error,
        // Do NOT leak allowlist contents
        allowlistConfigured: getAdminAllowlist(env).length > 0,
      }),
      { status, headers }
    )
  }

  console.log(`!!! ADMIN_AUTH_CHECK success email=${result.email} bypass=${result.bypass} env=${envName}`)
  return new Response(
    JSON.stringify({
      authed: true,
      email: result.email,
      bypass: !!result.bypass,
      env: envName,
      // Diagnostics only booleans, no PII leak except own email (already authed)
      diagnostics: {
        allowlistConfigured: getAdminAllowlist(env).length > 0,
        bypassEnabled: isAdminBypass(env),
      },
    }),
    {
      status: 200,
      headers: {
        ...headers,
        'Cache-Control': 'no-store',
      },
    }
  )
}
