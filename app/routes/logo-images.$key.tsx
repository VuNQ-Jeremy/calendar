import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireAdmin } from '../../server/services/auth';

/**
 * Serve one mascot logo out of the `logos/` prefix in R2.
 *
 * Unlike `zalo-media` and `flashcard-images`, this one is NOT a capability URL: the keys are
 * listed in full by the catalogue page, so an unguessable name would protect nothing. It is
 * gated on `requireAdmin` instead — the same gate as the page that renders it, because the
 * library is admin-only reference art and there is no student-facing consumer yet. When a
 * feature does start showing mascots to students, that consumer needs its own route with its
 * own (looser) gate; do not loosen this one, or the whole catalogue becomes public in passing.
 *
 * `params.key` is matched against the exact shape the importer mints, so no amount of `../`
 * reaches a material, a fee slip, or anything else in the bucket.
 */
export async function loader({ params, request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  await requireAdmin(request, env);

  const key = params.key ?? '';
  // `<16-hex>-<slug>.webp`, matching scripts/import-logos.mjs. No slashes, no traversal.
  if (!/^[0-9a-f]{16}-[a-z0-9-]+\.webp$/.test(key)) throw new Response(null, { status: 404 });

  const obj = await env.FILES.get(`logos/${key}`);
  if (!obj) throw new Response(null, { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': 'image/webp',
      // Immutable: the key carries a content hash, so a changed image is a changed key.
      // `private` because the gate above is per-user — this must not land in a shared cache.
      'cache-control': 'private, max-age=31536000, immutable',
    },
  });
}

// No default export — a component export would make React Router treat GETs as document
// requests and serve the SSR shell instead of the image. See zalo-media.$key.tsx.
