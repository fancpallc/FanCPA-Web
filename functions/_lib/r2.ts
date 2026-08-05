export interface R2Like {
  put: (key: string, value: string | Uint8Array, options?: any) => Promise<any>
  get: (key: string) => Promise<{ text: () => Promise<string> } | null>
  delete: (key: string) => Promise<void>
}

export interface R2CheckResult {
  ok: boolean
  ms: number
  error?: string
}

/**
 * Check R2 connectivity via PUT / GET / DELETE of tiny healthcheck object
 */
export async function checkR2(r2: R2Like | undefined): Promise<R2CheckResult> {
  const start = Date.now()

  if (!r2 || typeof r2.put !== 'function' || typeof r2.get !== 'function') {
    return {
      ok: false,
      ms: Date.now() - start,
      error: 'R2 binding missing or invalid',
    }
  }

  const key = `_healthcheck/${Date.now()}-${Math.random().toString(36).slice(2)}.txt`
  const value = `ok-${Date.now()}`

  try {
    await r2.put(key, value)
    const obj = await r2.get(key)
    if (!obj) {
      return {
        ok: false,
        ms: Date.now() - start,
        error: 'R2 GET returned null after PUT',
      }
    }
    const text = await obj.text()
    if (text !== value) {
      return {
        ok: false,
        ms: Date.now() - start,
        error: `R2 value mismatch: expected ${value}, got ${text}`,
      }
    }
    // cleanup, ignore delete errors
    try {
      await r2.delete(key)
    } catch {}
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
