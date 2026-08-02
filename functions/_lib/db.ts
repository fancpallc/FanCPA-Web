export interface D1Like {
  prepare: (sql: string) => {
    first: () => Promise<any>
  }
}

export interface D1CheckResult {
  ok: boolean
  ms: number
  error?: string
}

/**
 * Check D1 connectivity via SELECT 1
 */
export async function checkD1(db: D1Like | undefined): Promise<D1CheckResult> {
  const start = Date.now()
  if (!db || typeof db.prepare !== 'function') {
    return {
      ok: false,
      ms: Date.now() - start,
      error: 'D1 binding missing or invalid',
    }
  }

  try {
    const stmt = db.prepare('SELECT 1 as one')
    const result = await stmt.first()
    if (!result) {
      return {
        ok: false,
        ms: Date.now() - start,
        error: 'D1 returned no result',
      }
    }
    return {
      ok: true,
      ms: Date.now() - start,
    }
  } catch (e: any) {
    return {
      ok: false,
      ms: Date.now() - start,
      error: e?.message || String(e),
    }
  }
}
