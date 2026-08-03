import React from 'react'
import { Layout } from './components/common/Layout'
import { Home } from './pages/Home'
import { Health } from './pages/Health'
import { Admin } from './pages/Admin'
import { debug } from './lib/debug'
import { useContent } from './hooks/useContent'

/** Used only until the content request lands, and if the owner has cleared the field. */
const DEFAULT_SITE_NAME = 'Portfolio'

function App() {
  const path = typeof window !== 'undefined' ? window.location.pathname : '/'
  debug('!!! APP_ROUTING path=' + path)
  // The site's own name used to be a literal here and in Nav/Footer, so a portfolio
  // belonging to Jane Doe shipped with "Portfolio" in the header and the copyright line.
  const { data } = useContent('home')
  const siteName = data?.page?.site_name?.trim() || DEFAULT_SITE_NAME
  const pageTitle = data?.page?.title?.trim()

  React.useEffect(() => {
    document.title = path.startsWith('/admin')
      ? `Edit your site — ${siteName}`
      : path.startsWith('/health')
        ? `System health — ${siteName}`
        : pageTitle || siteName
  }, [path, siteName, pageTitle])

  React.useEffect(() => {
    const description = data?.page?.meta_description?.trim()
    if (!description) return
    const tag = document.querySelector('meta[name="description"]')
    if (tag) tag.setAttribute('content', description)
  }, [data?.page?.meta_description])

  // Simple routing — no react-router needed for MVP
  if (path.startsWith('/health')) {
    return <Health />
  }
  // Admin ships its own sticky toolbar — the public Nav would stack a second
  // sticky bar on top of it and expose #about/#calendar anchors that only exist
  // on the landing page.
  if (path.startsWith('/admin')) {
    return <Admin />
  }

  return (
    <Layout title={siteName}>
      <Home />
    </Layout>
  )
}

export default App
