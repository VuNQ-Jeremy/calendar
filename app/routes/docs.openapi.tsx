import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireStaffCookieOrBearer } from '../../server/api/auth';
import { getSpecJson } from '../../server/api/docs/build-spec';

/**
 * The OpenAPI 3.1 document for the JSON API, generated from `server/api/docs/registry.ts` and the
 * Zod schemas it points at. Rendered by `/docs/api`; also fine to hand to Postman or Insomnia.
 *
 * Staff-only, through the cookie-or-bearer hybrid guard: a signed-in browser reads it with its
 * session cookie (which is how Scalar's own fetch reaches it), and curl reads it with a bearer
 * token. Anonymous callers get the browser redirect, not a 401, because that is what a guard
 * outside `/api/*` does.
 *
 * The spec enumerates every admin endpoint in the school, which is the reason it is not public.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const { env } = context.get(cloudflareCtx);
  await requireStaffCookieOrBearer(request, env);

  return new Response(getSpecJson(new URL(request.url).origin), {
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      // Built once per isolate, but the document only changes when the code does.
      'Cache-Control': 'no-store',
    },
  });
}
