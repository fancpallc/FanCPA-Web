export interface Env {
  ENVIRONMENT?: string
  SITE_URL?: string
}

interface HealthResponse {
  status: 'ok'
  message: string
  timestamp: string
  env: string
}

export const onRequestGet: PagesFunction<Env> = async ({ env }) => {
  const timestamp = new Date().toISOString()
  const envName = env?.ENVIRONMENT || 'unknown'

  const response: HealthResponse = {
    status: 'ok',
    message: 'FanCPA API is running',
    timestamp,
    env: envName,
  }

  return new Response(JSON.stringify(response), {
    status: 200,
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-store, max-age=0',
      'Access-Control-Allow-Origin': '*',
    },
  })
}
