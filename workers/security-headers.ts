/**
 * Response headers applied to everything the Worker serves.
 *
 * NOT applied to the /ws upgrade: workers/app.ts returns that 101 before reaching here, and a
 * response carrying a live WebSocket must arrive at the runtime untouched.
 *
 * The CSP has no `script-src`, deliberately. /docs/api loads Scalar from cdn.jsdelivr.net
 * (app/routes/docs.api.tsx) and React Router inlines its hydration payload, so a strict policy
 * would break both. The three directives below cannot break a page — they block clickjacking,
 * <base> injection and plugin embeds — which is why they ship now while a nonce-based
 * script-src is left as documented follow-up work (docs/security.md).
 *
 * HSTS without `includeSubDomains`: this Worker also answers on *.workers.dev, and the narrower
 * header is the one with no capacity to surprise.
 */
export const SECURITY_HEADERS: Record<string, string> = {
  'Content-Security-Policy': "frame-ancestors 'none'; base-uri 'self'; object-src 'none'",
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Strict-Transport-Security': 'max-age=31536000',
};

/**
 * Copy `response` with the security headers set.
 *
 * `new Response(body, response)` rather than mutating `response.headers`, because headers on a
 * response returned by the router can be immutable. Passing the body through preserves
 * streaming, and passing the response as init preserves status, statusText and every existing
 * header — Set-Cookie included, which the login redirect depends on.
 */
export function secure(response: Response): Response {
  const out = new Response(response.body, response);
  for (const [key, value] of Object.entries(SECURITY_HEADERS)) out.headers.set(key, value);
  return out;
}
