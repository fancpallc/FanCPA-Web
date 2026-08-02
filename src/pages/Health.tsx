import React, { useEffect, useState } from 'react'
import { fetchHealth, type HealthResponse } from '../lib/api'
import { HealthBadge } from '../components/HealthBadge'
import { EnvBanner } from '../components/EnvBanner'

export function Health() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = async () => {
    setLoading(true)
    setError(null)
    try {
      const data = await fetchHealth({ timeoutMs: 8000 })
      setHealth(data)
    } catch (e: any) {
      setError(e.message || String(e))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    load()
  }, [])

  return (
    <div className="min-h-screen bg-white text-gray-900">
      {health && <EnvBanner env={health.env} />}
      <div className="max-w-3xl mx-auto px-6 py-10">
        <h1 className="text-2xl font-bold mb-6">System Health — Debug</h1>
        <p className="text-sm text-gray-600 mb-4">
          This page shows infra health (D1 + R2). For API: <code>/api/health</code> returns JSON.
        </p>
        <HealthBadge health={health} loading={loading} error={error} />
        <button onClick={load} className="mt-4 px-4 py-2 bg-black text-white rounded text-sm">Retry</button>
        {health && (
          <div className="mt-8 text-xs font-mono bg-gray-50 p-4 rounded">
            <div>Env: {health.env}</div>
            <div>DB: {health.db}</div>
            <div>R2: {health.r2}</div>
            <div>Timestamp: {health.timestamp}</div>
            {health.dbError && <div>DB Error: {health.dbError}</div>}
            {health.r2Error && <div>R2 Error: {health.r2Error}</div>}
          </div>
        )}
        <div className="mt-8">
          <a href="/" className="underline text-sm">← Back to Portfolio</a>
        </div>
      </div>
    </div>
  )
}
