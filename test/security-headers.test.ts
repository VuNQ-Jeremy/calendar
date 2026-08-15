import { describe, it, expect } from 'vitest';
import { secure, SECURITY_HEADERS } from '../workers/security-headers';

describe('secure', () => {
  it('sets every security header', () => {
    const out = secure(new Response('hi'));
    for (const [k, v] of Object.entries(SECURITY_HEADERS)) {
      expect(out.headers.get(k)).toBe(v);
    }
  });

  it('blocks framing, base-tag injection and plugin embeds', () => {
    const csp = SECURITY_HEADERS['Content-Security-Policy'];
    expect(csp).toContain("frame-ancestors 'none'");
    expect(csp).toContain("base-uri 'self'");
    expect(csp).toContain("object-src 'none'");
  });

  it('does not constrain scripts — /docs/api loads Scalar from a CDN', () => {
    expect(SECURITY_HEADERS['Content-Security-Policy']).not.toContain('script-src');
  });

  it('preserves the body', async () => {
    expect(await secure(new Response('payload')).text()).toBe('payload');
  });

  it('preserves status and existing headers, Set-Cookie above all', () => {
    const res = secure(
      new Response(null, {
        status: 302,
        headers: { Location: '/dashboard', 'Set-Cookie': '__mochi_session=abc; HttpOnly' },
      }),
    );
    expect(res.status).toBe(302);
    expect(res.headers.get('Location')).toBe('/dashboard');
    expect(res.headers.get('Set-Cookie')).toBe('__mochi_session=abc; HttpOnly');
    expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
  });

  it('handles a bodyless 204 without throwing', () => {
    expect(secure(new Response(null, { status: 204 })).status).toBe(204);
  });
});
