import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import {
  allow,
  loginKey,
  inviteKey,
  LOGIN_POLICY,
  INVITE_POLICY,
} from '../server/services/rate-limit';
import { auditALS, newRequestStore } from '../server/services/audit';

/** Run `fn` as if inside a real request from `ip`, which is what requestMeta() reads. */
function withIp(ip, fn) {
  const req = new Request('https://example.com/login', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });
  return auditALS.run(newRequestStore(req), fn);
}

/** A unique key per test, so counters never leak between them. */
let n = 0;
const freshKey = () => `test-key-${n++}`;

describe('allow — against the real RateLimiter Durable Object', () => {
  it('permits exactly `limit` attempts, then refuses', async () => {
    const key = freshKey();
    const policy = { limit: 3, periodMs: 60_000 };
    expect(await allow(env, key, policy)).toBe(true);
    expect(await allow(env, key, policy)).toBe(true);
    expect(await allow(env, key, policy)).toBe(true);
    // This is the assertion the native Cloudflare binding never satisfied.
    expect(await allow(env, key, policy)).toBe(false);
    expect(await allow(env, key, policy)).toBe(false);
  });

  it('counts each key independently, so one IP cannot lock out another', async () => {
    const a = freshKey();
    const b = freshKey();
    const policy = { limit: 1, periodMs: 60_000 };
    expect(await allow(env, a, policy)).toBe(true);
    expect(await allow(env, a, policy)).toBe(false);
    // b is untouched by a's exhaustion.
    expect(await allow(env, b, policy)).toBe(true);
  });

  it('starts a new window once the period has elapsed', async () => {
    const key = freshKey();
    // A zero-length window is always already expired, so every call opens a fresh one.
    const policy = { limit: 1, periodMs: 0 };
    expect(await allow(env, key, policy)).toBe(true);
    expect(await allow(env, key, policy)).toBe(true);
  });

  it('refuses a burst well past the limit, not just the first over it', async () => {
    const key = freshKey();
    const policy = { limit: 5, periodMs: 60_000 };
    const results = [];
    for (let i = 0; i < 20; i++) results.push(await allow(env, key, policy));
    expect(results.filter(Boolean)).toHaveLength(5);
    expect(results.slice(5).every((r) => r === false)).toBe(true);
  });

  it('fails OPEN when the binding is missing, so a misconfigured env still serves', async () => {
    expect(await allow({}, freshKey(), LOGIN_POLICY)).toBe(true);
  });

  it('fails OPEN when the stub throws', async () => {
    const broken = {
      RATE_LIMITER: {
        idFromName: () => 'id',
        get: () => ({
          check: async () => {
            throw new Error('boom');
          },
        }),
      },
    };
    expect(await allow(broken, freshKey(), LOGIN_POLICY)).toBe(true);
  });
});

describe('policies', () => {
  it('allows more invite checks than login attempts', () => {
    expect(INVITE_POLICY.limit).toBeGreaterThan(LOGIN_POLICY.limit);
  });

  it('uses a one-minute window for both', () => {
    expect(LOGIN_POLICY.periodMs).toBe(60_000);
    expect(INVITE_POLICY.periodMs).toBe(60_000);
  });
});

describe('key derivation', () => {
  it('scopes login attempts to the IP and the account together', async () => {
    await withIp('1.2.3.4', () => {
      expect(loginKey('Dev@Mochi.EDU')).toBe('login:1.2.3.4:dev@mochi.edu');
    });
  });

  it('normalises the email so casing cannot split the bucket', async () => {
    await withIp('1.2.3.4', () => {
      expect(loginKey('  DEV@MOCHI.EDU  ')).toBe(loginKey('dev@mochi.edu'));
    });
  });

  it('separates two accounts from the same IP', async () => {
    await withIp('1.2.3.4', () => {
      expect(loginKey('a@x.com')).not.toBe(loginKey('b@x.com'));
    });
  });

  it('scopes invite attempts to the IP alone — trying many codes IS the attack', async () => {
    await withIp('5.6.7.8', () => {
      expect(inviteKey()).toBe('invite:5.6.7.8');
    });
  });

  it('still yields a usable key when there is no IP header', async () => {
    await withIp(null, () => {
      expect(inviteKey()).toBe('invite:noip');
      expect(loginKey('a@x.com')).toBe('login:noip:a@x.com');
    });
  });
});
