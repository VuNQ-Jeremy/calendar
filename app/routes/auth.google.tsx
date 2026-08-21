import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { requireUser, safeNextPath } from '../../server/services/auth';
import { googleEnabled, beginGoogleAuth } from '../../server/services/google-auth';
import { oauthCookie } from '../../server/session';

/**
 * Start the Google sign-in redirect. `?next=` carries where to land after a successful login
 * (sanitized to a same-origin path); `?link=1` means an already-signed-in visitor wants to
 * attach Google to their own account from Profile, which requires a live session first.
 *
 * 404s (via redirect to /login, which is the closest thing to "this doesn't exist" a GET
 * navigation can show) when the OAuth client isn't configured — never starts a flow that could
 * not possibly finish.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  if (!googleEnabled(env)) throw redirect('/login');

  const url = new URL(request.url);
  const next = safeNextPath(url.searchParams.get('next'));
  const link = url.searchParams.get('link') === '1';

  if (link) {
    // Throws its own redirect to /login if nobody is signed in — linking is an explicit,
    // authenticated action from Profile, never a bare navigation.
    await requireUser(request, env);
  }

  const redirectUri = `${url.origin}/auth/google/callback`;
  const { redirectUrl, cookiePayload } = await beginGoogleAuth(env, redirectUri, { next, link });
  const cookieHeader = await oauthCookie.serialize(cookiePayload);
  return redirect(redirectUrl, { headers: { 'Set-Cookie': cookieHeader } });
}
