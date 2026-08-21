import { createCookie } from 'react-router';

export const sessionCookie = createCookie('__mochi_session', {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
});

/**
 * Short-lived scratch cookie for the Google OAuth code flow (server/services/google-auth.ts).
 * Holds `state`/`nonce`/`verifier` (all values THIS server generated, never user input) plus the
 * `next`/`link` intent across the redirect to Google and back — unsigned is fine for exactly that
 * reason. 10 minutes covers a slow sign-in without leaving a stale flow live for long.
 */
export const oauthCookie = createCookie('__mochi_oauth', {
  httpOnly: true,
  secure: true,
  sameSite: 'lax',
  path: '/',
  maxAge: 600,
});
