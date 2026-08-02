import { useEffect, useState, useCallback } from 'react'
import { fetchContent, type ContentResponse, type FetchOptions } from '../lib/api'

export interface UseContentReturn {
  data: ContentResponse | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export function useContent(slug: string, options?: FetchOptions): UseContentReturn {
  const [data, setData] = useState<ContentResponse | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const fetch = useCallback(async () => {
    setLoading(true)
    setError(null)
    try {
      const result = await fetchContent(slug, options)
      setData(result)
    } catch (e: any) {
      setError(e.message || String(e))
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [slug])

  useEffect(() => {
    fetch()
  }, [fetch])

  return { data, loading, error, refetch: fetch }
}
