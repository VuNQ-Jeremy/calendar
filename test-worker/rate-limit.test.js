import { describe, it, expect, vi } from 'vitest';
import { allow, loginKey, inviteKey } from '../server/services/rate-limit';
import { auditALS, newRequestStore } from '../server/services/audit';

/** Run `fn` as if inside a real request from `ip`, which is what requestMeta() reads. */
function withIp(ip, fn) {
  const req = new Request('https://example.com/login', {
    method: 'POST',
    headers: ip ? { 'CF-Connecting-IP': ip } : {},
  });
  return auditALS.run(newRequestStore(req), fn);
}

const pass = { limit: async () => ({ success: true }) };
const block = { limit: async () => ({ success: false }) };

describe('allow', () => {
  it('proceeds when the limiter says success', async () => {
    expect(await allow(pass, 'k')).toBe(true);
  });

  it('refuses when the limiter says failure', async () => {
    expect(await allow(block, 'k')).toBe(false);
  });

  it('passes the key straight through to the binding', async () => {
    const spy = vi.fn(async () => ({ success: true }));
    await allow({ limit: spy }, 'login:1.2.3.4:a@b.com');
    expect(spy).toHaveBeenCalledWith({ key: 'login:1.2.3.4:a@b.com' });
  });

  it('fails OPEN when the binding is missing, so a misconfigured env still serves', async () => {
    expect(await allow(undefined, 'k')).toBe(true);
  });

  it('fails OPEN when the limiter throws', async () => {
    expect(
      await allow(
        {
          limit: async () => {
            throw new Error('boom');
          },
        },
        'k',
      ),
    ).toBe(true);
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
