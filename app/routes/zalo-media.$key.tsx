import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';

/**
 * Serve a share-card image to Zalo. **Deliberately unauthenticated.**
 *
 * `sendPhoto` takes a URL, and Zalo's servers fetch it themselves — with no cookie, no bearer,
 * and no way to acquire either. Every other R2 route in this app is behind
 * `requireStaffCookieOrBearer`, so this one exists precisely because that will not work here.
 *
 * What stands in for authentication is the key: a v4 UUID minted per upload, unguessable and
 * never listed anywhere. This is a capability URL — the same trust model as an unlisted link.
 * Two things keep the blast radius small:
 *
 *   1. Only the `zalo/` prefix is reachable. `params.key` is a bare filename with no slashes
 *      (checked below), so no amount of `../` reaches a material, a fee slip, or anything else
 *      in the bucket.
 *   2. Objects are pruned after a week by the daily job, so a leaked URL stops working.
 *
 * The images themselves are the ones already being pasted into these group chats by hand, so
 * the exposure is not new — only the mechanism is.
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const key = params.key ?? '';

  // No slashes, no traversal, and shaped like what we mint: `<uuid>.png`.
  if (!/^[0-9a-f-]{36}\.png$/i.test(key)) throw new Response(null, { status: 404 });

  const obj = await env.FILES.get(`zalo/${key}`);
  if (!obj) throw new Response(null, { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': 'image/png',
      // Public: Zalo may fetch through its own caches, and the URL is already the secret.
      'cache-control': 'public, max-age=3600',
    },
  });
}

// No default export — a component export would make React Router treat GETs as document
// requests and serve the SSR shell instead of the image. See materials.$id.view.tsx.
