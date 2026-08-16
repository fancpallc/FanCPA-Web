// Bridges the server-side TURNSTILE_SITE_KEY (a Pages var, not visible to the browser)
// onto window so the client can render the Turnstile widget with it. Without this the
// client's `window.TURNSTILE_SITE_KEY` is undefined and the widget never renders.
// Keeps wrangler.toml's TURNSTILE_SITE_KEY as the single source of truth (rotate without a rebuild).
export const onRequest: PagesFunction<{ TURNSTILE_SITE_KEY?: string; DB?: any }> = async (ctx) => {
  const res = await ctx.next()
  if (!(res.headers.get('content-type') || '').includes('text/html')) return res
  const siteKey = ctx.env.TURNSTILE_SITE_KEY || ''

  // Try to fetch GTM ID from DB if configured
  let gtmId = null
  if (ctx.env.DB) {
     try {
       const page = await ctx.env.DB.prepare('SELECT google_tag_manager_id FROM pages WHERE slug = ?').bind('home').first()
       gtmId = page?.google_tag_manager_id
     } catch (e) {
       console.error('Failed to fetch GTM ID for middleware', e)
     }
  }
  let transformed = new HTMLRewriter()
    .on('head', {
      element(el) {
        el.append(`<script>window.TURNSTILE_SITE_KEY=${JSON.stringify(siteKey)}</script>`, { html: true })
        if (gtmId) {
          el.prepend(`<!-- Google Tag Manager -->
<script>(function(w,d,s,l,i){w[l]=w[l]||[];w[l].push({'gtm.start':
new Date().getTime(),event:'gtm.js'});var f=d.getElementsByTagName(s)[0],
j=d.createElement(s),dl=l!='dataLayer'?'&l='+l:'';j.async=true;j.src=
'https://www.googletagmanager.com/gtm.js?id='+i+dl;f.parentNode.insertBefore(j,f);
})(window,document,'script','dataLayer','${gtmId}');</script>
<!-- End Google Tag Manager -->`, { html: true })
        }
      },
    })

  if (gtmId) {
    transformed = transformed.on('body', {
      element(el) {
        el.prepend(`<!-- Google Tag Manager (noscript) -->
<noscript><iframe src="https://www.googletagmanager.com/ns.html?id=${gtmId}"
height="0" width="0" style="display:none;visibility:hidden"></iframe></noscript>
<!-- End Google Tag Manager (noscript) -->`, { html: true })
      }
    })
  }

  return transformed.transform(res)
}

