import { describe, it, expect } from 'vitest';
import { hashPassword, verifyPassword, hashToken, newToken } from '../server/services/crypto';

describe('hashPassword / verifyPassword', () => {
  it('verifies a correct password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('correct-horse-battery', hash)).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('correct-horse-battery');
    expect(await verifyPassword('wrong-password', hash)).toBe(false);
  });

  it('rejects a tampered stored hash', async () => {
    const hash = await hashPassword('my-password');
    // Corrupt the hash section
    const tampered = hash.replace(/\$([^$]+)$/, '$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=');
    expect(await verifyPassword('my-password', tampered)).toBe(false);
  });

  it('rejects an unknown scheme', async () => {
    expect(await verifyPassword('password', 'argon2$foo$bar$baz')).toBe(false);
  });

  it('produces different hashes for the same password (unique salt)', async () => {
    const h1 = await hashPassword('same-password');
    const h2 = await hashPassword('same-password');
    expect(h1).not.toBe(h2);
    // Both should still verify correctly
    expect(await verifyPassword('same-password', h1)).toBe(true);
    expect(await verifyPassword('same-password', h2)).toBe(true);
  });

  it('stores the pbkdf2 scheme marker', async () => {
    const hash = await hashPassword('test');
    expect(hash.startsWith('pbkdf2$')).toBe(true);
  });
});

describe('newToken / hashToken', () => {
  it('returns a raw token and its SHA-256 hex hash', async () => {
    const { token, hash } = await newToken();
    expect(typeof token).toBe('string');
    expect(typeof hash).toBe('string');
    expect(hash).toHaveLength(64); // SHA-256 hex = 64 chars
  });

  it('stored hash differs from raw token', async () => {
    const { token, hash } = await newToken();
    expect(token).not.toBe(hash);
  });

  it('hashToken is deterministic', async () => {
    const { token } = await newToken();
    const h1 = await hashToken(token);
    const h2 = await hashToken(token);
    expect(h1).toBe(h2);
  });

  it('two tokens produce different hashes', async () => {
    const t1 = await newToken();
    const t2 = await newToken();
    expect(t1.token).not.toBe(t2.token);
    expect(t1.hash).not.toBe(t2.hash);
  });
});
