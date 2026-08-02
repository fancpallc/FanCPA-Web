import React from 'react'

export interface EnvBannerProps {
  env: string
}

export function EnvBanner({ env }: EnvBannerProps) {
  const normalized = (env || '').toLowerCase()
  const isProd = normalized === 'production'
  const isAlpha = normalized === 'alpha'
  const isPreview = normalized === 'preview'

  let bg = 'bg-yellow-500'
  let label = `[${env.toUpperCase()}]`
  let detail = 'Testing environment'

  if (isAlpha) {
    bg = 'bg-orange-500'
    detail = 'Alpha — BOLD ORANGE ✅'
  } else if (isProd) {
    bg = 'bg-green-600'
    detail = 'PROD — BOLD GREEN ✅ merged from alpha!'
  } else if (isPreview) {
    bg = 'bg-blue-500'
    detail = 'Preview deployment — testing'
  } else if (normalized === 'local' || normalized === 'test') {
    bg = 'bg-gray-500'
    detail = 'Local development'
  }

  // Both alpha and prod bold now to verify prod deploy
  return (
    <div className={`${bg} text-white text-center py-3 px-4 text-sm font-mono font-black text-lg border-4 border-black`}>
      <span className="font-bold" style={{ fontWeight: 900, fontSize: '1.5em', textTransform: 'uppercase' }}>
        {label} — BOLD {env.toUpperCase()} MODE — {detail}
      </span> — env: <strong style={{ fontWeight: 900 }}>{env}</strong> — ✅ Deploy working!
    </div>
  )
}
