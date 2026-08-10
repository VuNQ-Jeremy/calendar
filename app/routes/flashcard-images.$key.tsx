import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../load-context';

/**
 * Serve a vocabulary word's picture. **Deliberately unauthenticated**, like zalo-media.$key.tsx.
 *
 * Students study on the mobile app, which renders `<Image>` tags — those requests carry no cookie
 * and no bearer token, and there is no way to give them one. Putting these behind
 * `requireStaffCookieOrBearer` would mean no student ever sees a picture.
 *
 * What stands in for authentication is the key: a v4 UUID minted server-side per image, never
 * listed anywhere. This is a capability URL. Two things keep the blast radius small:
 *
 *   1. Only the `flashcards/` prefix is reachable. `params.key` is a bare filename with no
 *      slashes (checked below), so no amount of `../` reaches a material or a fee slip.
 *   2. The pictures are stock photos and generated illustrations — nothing about a child, and
 *      nothing that was private to begin with.
 *
 * Unlike the Zalo cards these are NOT pruned on a timer: a word points at its picture for as long
 * as the word exists. `pruneImages` only collects objects no word references.
 */
export async function loader({ params, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const key = params.key ?? '';

  // No slashes, no traversal, and shaped like what we mint: `<uuid>.<jpg|png|webp>`.
  if (!/^[0-9a-f-]{36}\.(jpg|png|webp)$/i.test(key)) throw new Response(null, { status: 404 });

  const obj = await env.FILES.get(`flashcards/${key}`);
  if (!obj) throw new Response(null, { status: 404 });

  return new Response(obj.body, {
    headers: {
      'content-type': obj.httpMetadata?.contentType ?? 'image/jpeg',
      // Immutable: a key is minted once and its bytes are never rewritten — replacing a word's
      // picture mints a new key. So this can be cached hard, which matters on a phone mid-game.
      'cache-control': 'public, max-age=31536000, immutable',
    },
  });
}

// No default export — a component export would make React Router treat GETs as document
// requests and serve the SSR shell instead of the image. See zalo-media.$key.tsx.
