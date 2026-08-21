// Workers (workerd) enforces a hard cap of 100,000 iterations for PBKDF2
// deriveBits; exceeding it throws instead of derating, so this must stay <=100_000.
const ITERATIONS = 100_000;

/**
 * Sentinel stored in `accounts.password_hash` for a passwordless (Zalo-only) account.
 *
 * `verifyPassword` only ever accepts a `pbkdf2$<iter>$<salt>$<hash>` string, so this can never
 * match any password — and `login()`/`changePassword()` route it to the same DUMMY_HASH branch
 * as a missing account, so a passwordless account fails a password attempt with identical
 * timing to a wrong-password one. Keeping the column NOT NULL avoids the nullable rebuild
 * migration 0045 needed for `tenants` (a DROP TABLE fires FK actions on D1).
 */
export const NO_PASSWORD = '!';

function b64(buf: Uint8Array): string {
  return btoa(String.fromCharCode(...buf));
}

function unb64(s: string): Uint8Array<ArrayBuffer> {
  return Uint8Array.from(atob(s), (c) => c.charCodeAt(0)) as Uint8Array<ArrayBuffer>;
}

async function derive(
  password: string,
  salt: Uint8Array<ArrayBuffer>,
  iterations: number,
): Promise<Uint8Array<ArrayBuffer>> {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(password),
    'PBKDF2',
    false,
    ['deriveBits'],
  );
  return new Uint8Array(
    await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, key, 256),
  );
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i] ^ b[i];
  return diff === 0;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${b64(salt)}$${b64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split('$');
  const [scheme, iter, saltB64, hashB64] = parts;
  if (scheme !== 'pbkdf2' || parts.length !== 4 || !saltB64 || !hashB64) {
    console.error('[auth] verify.malformed_hash', {
      scheme,
      partCount: parts.length,
      storedLength: stored.length,
    });
    return false;
  }
  const expected = unb64(hashB64);
  const actual = await derive(password, unb64(saltB64), parseInt(iter, 10));
  return timingSafeEqual(actual, expected);
}

export async function hashToken(token: string): Promise<string> {
  const data = new TextEncoder().encode(token);
  const buf = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(buf))
    .map((b) => b.toString(16).padStart(2, '0'))
    .join('');
}

export async function newToken(): Promise<{ token: string; hash: string }> {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const token = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=/g, '');
  const hash = await hashToken(token);
  return { token, hash };
}
