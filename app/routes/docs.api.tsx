import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';

/**
 * The API reference — Scalar, pointed at `/docs/openapi.json`.
 *
 * A resource route on purpose: with no default export React Router serves this Response verbatim,
 * so the page never loads the app shell and `src/styles/app.css` (which `app/root.tsx` imports
 * globally, and which would otherwise reach in and restyle Scalar's markup) never applies. It is
 * the same reasoning as the printable document routes in `app/routes.ts`.
 *
 * Scalar itself comes from the CDN rather than `build/client`, because Cloudflare's asset layer
 * serves that directory BEFORE the Worker runs — an asset cannot be put behind the staff guard,
 * and the point of this route is that the spec is not public. Only the spec needs guarding; the
 * viewer is public code either way. The version is pinned so a CDN release cannot change the page
 * under us. See also `xlsx` in package.json for the existing CDN-as-a-dependency precedent.
 */
const SCALAR =
  'https://cdn.jsdelivr.net/npm/@scalar/api-reference@1.65.1/dist/browser/standalone.min.js';

const PAGE = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <meta name="robots" content="noindex" />
    <title>Mochi API</title>
  </head>
  <body>
    <div id="app"></div>
    <script src="${SCALAR}"></script>
    <script>
      Scalar.createApiReference('#app', {
        url: '/docs/openapi.json',
        authentication: { preferredSecurityScheme: 'bearerAuth' },
      });
    </script>
  </body>
</html>
`;

export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareCtx);
  await requireStaffCookieOrBearer(request, env);

  return new Response(PAGE, {
    headers: { 'Content-Type': 'text/html; charset=utf-8' },
  });
}
