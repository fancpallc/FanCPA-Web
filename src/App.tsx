import React, { useEffect, useState } from 'react'
import { fetchHealth, type HealthResponse } from './lib/api'

export default function App() {
  const [health, setHealth] = useState<HealthResponse | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    fetchHealth()
      .then(setHealth)
      .catch((err: Error) => setError(err.message))
  }, [])

  return (
    <main className="app">
      <span className="badge">Hello World</span>
      <h1>FanCPA</h1>
      <p>CPA web application — Cloudflare Pages + React</p>

      <section className="health" aria-label="API health status">
        <h2 style={{ marginTop: 0, fontSize: '1rem' }}>Health Check</h2>
        {error && <p className="error">{error}</p>}
        {health && (
          <dl>
            <dt>Status</dt>
            <dd>{health.status}</dd>
            <dt>Message</dt>
            <dd>{health.message}</dd>
            <dt>Environment</dt>
            <dd>{health.env}</dd>
            <dt>Timestamp</dt>
            <dd>{health.timestamp}</dd>
          </dl>
        )}
        {!health && !error && <p>Loading health check…</p>}
      </section>
    </main>
  )
}
