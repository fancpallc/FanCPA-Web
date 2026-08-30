/**
 * CSS coverage guard — every className token used in src tsx files must be defined in src/index.css.
 * No Tailwind build step, so undefined classes silently do nothing (hover overlays permanent, spacing collapse,
 * Drive Save/Edit/Delete invisible due to bg-blue-600 missing).
 *
 * False negative fixed: previously used css.includes('.' + token) → substring match
 *   .space-y-1 matched .space-y-10, so inert class passed. Same for p-2 vs p-2.5, w-1 vs w-11.
 *   Now uses exact set of defined utilities extracted from CSS via placeholder method, not substring.
 *
 * Blind spots fixed:
 * - Stripping ${...} entirely hid original invisible-button bug shape (class inside ${cond ? 'bg-blue-600' : ...})
 *   → now extracts quoted strings inside ${} and static parts separately.
 * - Ternary className={cond ? '' : 'hidden'} (BookingForm.tsx:417) matched none of 4 regexes → now generic brace handling.
 * - Guard could pass with 0 tokens → now asserts >100 found.
 */
import { describe, it, expect } from 'vitest'
import fs from 'fs'
import path from 'path'

function unescapeCss(s: string): string {
  return s.replace(/\\\[/g, '[').replace(/\\\]/g, ']').replace(/\\\//g, '/').replace(/\\:/g, ':').replace(/\\\./g, '.').replace(/\\\\/g, '\\')
}

function getUtilityFromRaw(raw: string): string {
  const ph = '__ESC_COLON__'
  const withPh = raw.replace(/\\:/g, ph)
  const first = withPh.split(':')[0]
  const restored = first.replace(new RegExp(ph, 'g'), '\\:')
  return unescapeCss(restored)
}

function extractDefinedTokens(css: string): Set<string> {
  const set = new Set<string>()
  // Every ".class" occurrence — includes .group:hover, .hover\:bg-..., .bg-black\/50, .space-y-10 > ...
  for (const m of css.matchAll(/\.([A-Za-z0-9\\:\/\[\]\-_.%]+)/g)) {
    const raw = m[1]
    const util = getUtilityFromRaw(raw)
    if (util) set.add(util)
  }
  return set
}

function extractUsedTokens(srcRoot: string): Set<string> {
  const tokens = new Set<string>()
  const SIMPLE_ALLOW = new Set([
    'hidden',
    'block',
    'flex',
    'grid',
    'inline',
    'inline-block',
    'inline-flex',
    'relative',
    'absolute',
    'fixed',
    'sticky',
    'sr-only',
    'truncate',
    'break-all',
    'italic',
    'underline',
    'uppercase',
    'grayscale',
    'group',
    'card',
    'hero',
  ])

  function isClassLike(t: string): boolean {
    if (t.includes('-') || t.includes(':') || t.includes('[') || t.includes('/') || t.includes('.')) return true
    if (SIMPLE_ALLOW.has(t)) return true
    return false
  }

  function addToken(p: string) {
    if (!p) return
    if (p.startsWith('http')) return
    if (!/^[A-Za-z0-9\-:/\[\].]+$/.test(p)) return
    if (p === ':' || p === '?' || p.length === 1) return
    if (['true', 'false', 'null', 'undefined'].includes(p)) return
    if (!isClassLike(p)) return
    tokens.add(p)
  }

  function addFromStaticString(classStr: string) {
    const parts = classStr.split(/\s+/).map((t) => t.trim()).filter(Boolean)
    for (const p of parts) addToken(p)
  }

  function addFromTemplateLiteralContent(content: string) {
    // Quoted class strings inside ${...} like ${cond ? 'bg-blue-600' : 'bg-slate-100'}
    const quoteRe = /(['"])((?:[A-Za-z0-9\-:/\[\].\s])+)\1/g
    let mm: RegExpExecArray | null
    while ((mm = quoteRe.exec(content)) !== null) {
      const inner = mm[2]
      inner.split(/\s+/).map((t) => t.trim()).filter(Boolean).forEach(addToken)
    }
    const staticPart = content.replace(/\$\{[^}]*\}/g, ' ')
    const withoutQuotes = staticPart.replace(/['"][^'"]*['"]/g, ' ')
    withoutQuotes.split(/\s+/).map((t) => t.trim()).filter(Boolean).forEach((t) => {
      if (t.includes('${')) return
      if (t.includes("'") || t.includes('"') || t.includes('`')) return
      addToken(t)
    })
  }

  function addQuotedOnly(inner: string) {
    const quoteRe = /(['"])((?:[A-Za-z0-9\-:/\[\].\s])+)\1/g
    let mm: RegExpExecArray | null
    while ((mm = quoteRe.exec(inner)) !== null) {
      const inside = mm[2]
      inside.split(/\s+/).map((t) => t.trim()).filter(Boolean).forEach(addToken)
    }
  }

  function walk(dir: string) {
    const entries = fs.readdirSync(dir, { withFileTypes: true })
    for (const e of entries) {
      const full = path.join(dir, e.name)
      if (e.isDirectory()) {
        if (e.name === 'node_modules' || e.name === 'dist') continue
        walk(full)
      } else if (e.isFile() && full.endsWith('.tsx')) {
        if (full.includes('styles.coverage.test')) continue
        const content = fs.readFileSync(full, 'utf8')
        let m: RegExpExecArray | null
        const reDouble = /className\s*=\s*"([^"]+)"/g
        while ((m = reDouble.exec(content)) !== null) addFromStaticString(m[1])
        const reSingle = /className\s*=\s*'([^']+)'/g
        while ((m = reSingle.exec(content)) !== null) addFromStaticString(m[1])
        const reBacktick = /className\s*=\s*\{`([^`]*?)`\}/g
        while ((m = reBacktick.exec(content)) !== null) addFromTemplateLiteralContent(m[1])
        const reBraceDouble = /className\s*=\s*\{"([^"]+)"\}/g
        while ((m = reBraceDouble.exec(content)) !== null) addFromStaticString(m[1])
        const reBraceSingle = /className\s*=\s*\{'([^']+)'\}/g
        while ((m = reBraceSingle.exec(content)) !== null) addFromStaticString(m[1])
        // Generic ternary / conditional: className={cond ? 'a' : 'b'} — BookingForm.tsx:417 shape
        const reGeneric = /className\s*=\s*\{([^{}]*\?[^}]*:[^}]*)\}/g
        while ((m = reGeneric.exec(content)) !== null) addQuotedOnly(m[1])
      }
    }
  }
  walk(srcRoot)
  return tokens
}

describe('styles coverage guard', () => {
  it('every className token used in src/**/*.tsx must be defined in src/index.css', () => {
    const cssPath = path.join(__dirname, '..', 'index.css')
    const srcRoot = path.join(__dirname, '..')
    const css = fs.readFileSync(cssPath, 'utf8')
    const used = extractUsedTokens(srcRoot)
    const defined = extractDefinedTokens(css)

    expect(used.size, `extraction found ${used.size} tokens, expected >100 — regexes may be broken`).toBeGreaterThan(100)
    expect(defined.size, `defined extraction found ${defined.size} tokens, expected >200`).toBeGreaterThan(200)

    const missing = [...used].filter((tok) => !defined.has(tok))

    if (missing.length) {
      console.log('Missing CSS utilities:', missing.sort().join(', '))
    }

    expect(
      missing,
      `Missing CSS utilities (defined in src/index.css). Add them or replace with existing classes. Missing: ${missing.sort().join(', ')}`
    ).toEqual([])
  })
})
