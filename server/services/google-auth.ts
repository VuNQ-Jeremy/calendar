import { eq } from 'drizzle-orm';
import type { Db } from '../db';
import { accounts } from '../db/schema';
import { isRealEmail } from './email';

/**
 * "Sign in with Google" — web only, login-only (no signup). A dependency-free OAuth
 * authorization-code flow with PKCE, state and nonce, all hand-rolled with WebCrypto because the
 * whole exchange is three fetches and a JWT payload decode.
 *
 * **No JWKS / signature verification.** The id_token arrives directly from Google's token
 * endpoint over TLS, authenticated with the client secret — per OIDC Core §3.1.3.7, signature
 * verification is not required in the authorization code flow precisely because the channel
 * itself is trusted. `iss`/`aud`/`exp`/`nonce` are still checked by hand below.
 *
 * **Matching an identity to an account, in order:**
 *   1. `accounts.google_sub` already pinned to this sub → that account.
 *   2. Else, only when Google says the email is verified AND it matches a real (non-synthetic)
 *      account email AND *we* have already verified that email ourselves
 *      (`accounts.email_verified_at`, server/services/auth.ts's pull-based flow) → pin the sub and
 *      sign in. Requiring OUR verification too, not just Google's claim, closes the
 *      pre-planted-email attack: someone who registers a victim's Gmail address on a Mochi account
 *      they control cannot then hijack the victim's real Google sign-in, because that Mochi
 *      account's email was never verified through OUR link.
 *   3. Otherwise, refused — the visitor signs in with a password and links Google from Profile
 *      instead (an explicit action, which pins the sub directly without needing email match).
 */

export function googleEnabled(env: Env): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID?.trim() && env.GOOGLE_CLIENT_SECRET?.trim());
}

function base64url(bytes: Uint8Array): string {
  let str = '';
  for (const b of bytes) str += String.fromCharCode(b);
  return btoa(str).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64urlToBase64(s: string): string {
  const b64 = s.replace(/-/g, '+').replace(/_/g, '/');
  const pad = b64.length % 4 === 0 ? '' : '='.repeat(4 - (b64.length % 4));
  return b64 + pad;
}

function randomBase64url(byteLength: number): string {
  return base64url(crypto.getRandomValues(new Uint8Array(byteLength)));
}

async function sha256Base64url(input: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(input));
  return base64url(new Uint8Array(digest));
}

/** What the oauth cookie carries across the redirect to Google and back. All server-generated —
 * never user input — which is what makes an unsigned cookie fine here. */
export type OauthCookiePayload = {
  state: string;
  nonce: string;
  verifier: string;
  next: string | null;
  link: boolean;
};

export async function beginGoogleAuth(
  env: Env,
  redirectUri: string,
  opts: { next: string | null; link: boolean },
): Promise<{ redirectUrl: string; cookiePayload: OauthCookiePayload }> {
  const state = randomBase64url(16);
  const nonce = randomBase64url(16);
  const verifier = randomBase64url(32);
  const challenge = await sha256Base64url(verifier);
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!.trim(),
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'openid email profile',
    state,
    nonce,
    code_challenge: challenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return {
    redirectUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`,
    cookiePayload: { state, nonce, verifier, next: opts.next, link: opts.link },
  };
}

export type GoogleIdentity = { sub: string; email: string; emailVerified: boolean };

type IdTokenPayload = {
  iss?: string;
  aud?: string;
  exp?: number;
  nonce?: string;
  sub?: string;
  email?: string;
  email_verified?: boolean;
};

/** Exchange the authorization code for an id_token, then validate it by hand. Null on ANY
 * failure — a bad code, a network error, or a claim that doesn't check out. */
export async function exchangeAndValidate(
  env: Env,
  opts: { code: string; verifier: string; nonce: string; redirectUri: string },
): Promise<GoogleIdentity | null> {
  try {
    const res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'content-type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code: opts.code,
        client_id: env.GOOGLE_CLIENT_ID!.trim(),
        client_secret: env.GOOGLE_CLIENT_SECRET!.trim(),
        redirect_uri: opts.redirectUri,
        grant_type: 'authorization_code',
        code_verifier: opts.verifier,
      }),
    });
    if (!res.ok) return null;
    const body = (await res.json()) as { id_token?: string };
    if (!body.id_token) return null;

    const parts = body.id_token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(base64urlToBase64(parts[1]))) as IdTokenPayload;

    if (payload.iss !== 'https://accounts.google.com' && payload.iss !== 'accounts.google.com') {
      return null;
    }
    if (payload.aud !== env.GOOGLE_CLIENT_ID!.trim()) return null;
    if (!payload.exp || payload.exp * 1000 < Date.now()) return null;
    if (!payload.nonce || payload.nonce !== opts.nonce) return null;
    if (!payload.sub || !payload.email) return null;

    return {
      sub: payload.sub,
      email: payload.email.toLowerCase(),
      emailVerified: payload.email_verified === true,
    };
  } catch (err) {
    console.error('[google-auth] exchange threw', { err: String(err) });
    return null;
  }
}

export type MatchResult = { accountId: string; tenantId: string } | { error: 'no_account' };

export async function matchGoogleAccount(
  rawDb: Db,
  identity: GoogleIdentity,
): Promise<MatchResult> {
  const bySub = await rawDb.query.accounts.findFirst({
    where: eq(accounts.googleSub, identity.sub),
  });
  if (bySub) return { accountId: bySub.id, tenantId: bySub.tenantId };

  if (identity.emailVerified) {
    const byEmail = await rawDb.query.accounts.findFirst({
      where: eq(accounts.email, identity.email),
    });
    if (byEmail && isRealEmail(byEmail.email) && byEmail.emailVerifiedAt) {
      await rawDb
        .update(accounts)
        .set({ googleSub: identity.sub })
        .where(eq(accounts.id, byEmail.id));
      return { accountId: byEmail.id, tenantId: byEmail.tenantId };
    }
  }

  return { error: 'no_account' };
}
