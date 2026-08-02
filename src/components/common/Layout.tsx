import React from 'react'
import { Nav } from './Nav'
import { Footer } from './Footer'

export interface LayoutProps {
  children: React.ReactNode
  title?: string
}

export function Layout({ children, title }: LayoutProps) {
  return (
    <div className="min-h-screen bg-white text-gray-900 flex flex-col">
      <a href="#main" className="sr-only focus:not-sr-only">Skip to content</a>
      <Nav title={title} />
      <main id="main" tabIndex={-1} className="flex-1">{children}</main>
      <Footer />
    </div>
  )
}
