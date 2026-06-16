/**
 * api-docs/route.ts — Serves the interactive API reference at /api-docs.
 *
 * Inputs:  none (reads /openapi.json client-side)
 * Outputs: a full HTML page that renders the Scalar API reference for the spec
 *          at web/public/openapi.json.
 * Used by: operators/developers via the SideNav "API docs" link.
 *
 * Why a Route Handler + CDN (not @scalar/nextjs-api-reference): that package
 * peer-depends on Next 15/16, but this app is on Next 14.2. The Scalar
 * standalone bundle is the officially-supported zero-dependency path and gives
 * the identical UI. The spec is served same-origin so no proxy is needed.
 */

const html = `<!doctype html>
<html lang="en">
  <head>
    <title>LeadGen Pipeline API — Reference</title>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <style>body { margin: 0; }</style>
  </head>
  <body>
    <div id="app"></div>
    <script src="https://cdn.jsdelivr.net/npm/@scalar/api-reference"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/openapi.json',
        theme: 'default',
        hideDownloadButton: false,
        metaData: { title: 'LeadGen Pipeline API' },
      })
    </script>
  </body>
</html>`;

export function GET(): Response {
  return new Response(html, {
    headers: {
      "content-type": "text/html; charset=utf-8",
      "cache-control": "public, max-age=3600",
    },
  });
}
