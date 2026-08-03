/** The fragment of an in-page link, or null if the URL points somewhere else. */
export function anchorOf(url?: string | null): string | null {
  if (!url) return null
  const match = /^\/?#(.+)$/.exec(url.trim())
  return match ? match[1] : null
}

/**
 * True when `url` targets a section that isn't on the page.
 *
 * Link targets are owner-editable content, so hiding the Services section used to
 * leave the hero's primary CTA pointing at `/#services` — a button that looked fine
 * and did nothing. `anchors === undefined` means the caller didn't say what exists,
 * in which case we assume the link is good.
 */
export function isDeadAnchor(url: string | null | undefined, anchors?: Set<string>): boolean {
  if (!anchors) return false
  const anchor = anchorOf(url)
  return anchor !== null && !anchors.has(anchor)
}
