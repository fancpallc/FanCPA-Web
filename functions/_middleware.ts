// Bridges the server-side TURNSTILE_SITE_KEY (a Pages var, not visible to the browser)
// onto window so the client can render the Turnstile widget with it. Without this the
// client's `window.TURNSTILE_SITE_KEY` is undefined and the widget never renders.
// Keeps wrangler.toml's TURNSTILE_SITE_KEY as the single source of truth (rotate without a rebuild).
export const onRequest: PagesFunction<{ TURNSTILE_SITE_KEY?: string }> = async (ctx) => {
  const res = await ctx.next()
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res
  const siteKey = ctx.env.TURNSTILE_SITE_KEY || ''
  return new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(`<script>window.TURNSTILE_SITE_KEY=${JSON.stringify(siteKey)}</script>`, { html: true })
      },
    })
    .transform(res)
}
