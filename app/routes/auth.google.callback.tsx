import { eq } from 'drizzle-orm';
import { redirect } from 'react-router';
import type { LoaderFunctionArgs } from 'react-router';
import { cloudflareCtx } from '../../app/load-context';
import { createRawDb } from '../../server/db/internal';
import { accounts } from '../../server/db/schema';
import { requireUser, createSession } from '../../server/services/auth';
import {
  exchangeAndValidate,
  matchGoogleAccount,
  type OauthCookiePayload,
} from '../../server/services/google-auth';
import { allow, googleCallbackKey, LOGIN_POLICY } from '../../server/services/rate-limit';
import { oauthCookie, sessionCookie } from '../../server/session';

/**
 * The redirect target Google sends the visitor back to. Every exit clears the oauth cookie —
 * the flow it describes is over one way or another the moment this runs.
 */
export async function loader({ request, context }: LoaderFunctionArgs) {
  const env = context.get(cloudflareCtx).env;
  const url = new URL(request.url);
  const clearCookie = await oauthCookie.serialize('', { maxAge: 0 });
  const fail = (path: string) => redirect(path, { headers: { 'Set-Cookie': clearCookie } });

  if (!(await allow(env, googleCallbackKey(), LOGIN_POLICY))) {
    return fail('/login?error=auth_rate_limited');
  }

  const raw = await oauthCookie.parse(request.headers.get('Cookie'));
  const payload = raw as OauthCookiePayload | null;
  if (!payload) return fail('/login?error=google_state');

  const state = url.searchParams.get('state');
  if (!state || state !== payload.state) return fail('/login?error=google_state');

  const code = url.searchParams.get('code');
  if (!code) return fail('/login?error=google_failed');

  const redirectUri = `${url.origin}/auth/google/callback`;
  const identity = await exchangeAndValidate(env, {
    code,
    verifier: payload.verifier,
    nonce: payload.nonce,
    redirectUri,
  });
  if (!identity) return fail('/login?error=google_failed');

  const rawDb = createRawDb(env);

  if (payload.link) {
    // Linking is an explicit, authenticated action — re-check the session rather than trust the
    // cookie payload alone, in case it was signed out mid-flow.
    const sessionUser = await requireUser(request, env);
    const existing = await rawDb.query.accounts.findFirst({
      where: eq(accounts.googleSub, identity.sub),
    });
    if (existing && existing.id !== sessionUser.account.id) {
      return redirect('/profile?error=google_sub_taken', {
        headers: { 'Set-Cookie': clearCookie },
      });
    }
    const emailMatches =
      identity.emailVerified && identity.email === sessionUser.account.email.toLowerCase();
    await rawDb
      .update(accounts)
      .set({
        googleSub: identity.sub,
        ...(emailMatches ? { emailVerifiedAt: new Date().toISOString() } : {}),
      })
      .where(eq(accounts.id, sessionUser.account.id));
    return redirect('/profile', { headers: { 'Set-Cookie': clearCookie } });
  }

  const match = await matchGoogleAccount(rawDb, identity);
  if ('error' in match) return fail('/login?error=google_no_account');

  const token = await createSession(rawDb, match.accountId, true);
  const sessionHeader = await sessionCookie.serialize(token, { maxAge: 30 * 24 * 3600 });
  const headers = new Headers();
  headers.append('Set-Cookie', clearCookie);
  headers.append('Set-Cookie', sessionHeader);
  const dest = payload.next && payload.next.startsWith('/') ? payload.next : '/dashboard';
  return redirect(dest, { headers });
}
