import React from 'react'
import type { HealthResponse } from '../lib/api'

export interface HealthBadgeProps {
  health: HealthResponse | null
  loading: boolean
  error: string | null
}

export function HealthBadge({ health, loading, error }: HealthBadgeProps) {
  if (loading) {
    return (
      <div className="p-4 border rounded bg-gray-50">
        <span className="animate-pulse">Checking infra… DB + R2 health</span>
      </div>
    )
  }

  if (error) {
    return (
      <div className="p-4 border border-red-300 rounded bg-red-50 text-red-700">
        <div className="font-bold">Error</div>
        <div className="text-sm mt-1">{error}</div>
      </div>
    )
  }

  if (!health) {
    return null
  }

  const isOk = health.status === 'ok'

  return (
    <div className={`p-4 border rounded ${isOk ? 'bg-green-50 border-green-300' : 'bg-red-50 border-red-300'}`}>
      <div className="flex gap-4 flex-wrap">
        <span className={`px-2 py-1 rounded text-sm font-mono ${health.db === 'ok' ? 'bg-green-200' : 'bg-red-200'}`}>
          DB: {health.db}
        </span>
        <span className={`px-2 py-1 rounded text-sm font-mono ${health.r2 === 'ok' || (health.r2 as any) === 'skipped' ? 'bg-green-200' : 'bg-red-200'}`}>
          R2: {health.r2}
        </span>
        <span className="px-2 py-1 rounded text-sm font-mono bg-gray-200">
          env: {health.env}
        </span>
        {health.checks && (
          <>
            <span className="px-2 py-1 rounded text-sm font-mono bg-gray-100">
              D1: {health.checks.d1Ms}ms
            </span>
            <span className="px-2 py-1 rounded text-sm font-mono bg-gray-100">
              R2: {health.checks.r2Ms}ms
            </span>
          </>
        )}
      </div>
      <div className="text-xs text-gray-500 mt-2 font-mono">timestamp: {health.timestamp}</div>
      {health.dbError && <div className="text-xs text-red-600 mt-1">DB error: {health.dbError}</div>}
      {health.r2Error && <div className="text-xs text-red-600 mt-1">R2 error: {health.r2Error}</div>}
    </div>
  )
}
