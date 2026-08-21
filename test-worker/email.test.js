import { describe, it, expect, beforeEach, vi } from 'vitest';
import { isEmailEnabled, isRealEmail, sendEmail } from '../server/services/email';

/**
 * Email delivery (Brevo). Disabled-by-default and the synthetic-address guard matter more than
 * the happy path — see server/services/email.ts's header comment.
 */

const ON = { EMAIL_API_KEY: 'brevo-key', EMAIL_FROM: 'noreply@example.com' };
const OFF = {};

let calls = [];

beforeEach(() => {
  calls = [];
  vi.stubGlobal(
    'fetch',
    vi.fn(async (url, init) => {
      calls.push({ url: String(url), body: JSON.parse(init.body) });
      return new Response('{}', { status: 200 });
    }),
  );
});

describe('isEmailEnabled', () => {
  it('requires both EMAIL_API_KEY and EMAIL_FROM', () => {
    expect(isEmailEnabled(ON)).toBe(true);
    expect(isEmailEnabled({ EMAIL_API_KEY: 'k' })).toBe(false);
    expect(isEmailEnabled({ EMAIL_FROM: 'a@b.com' })).toBe(false);
    expect(isEmailEnabled(OFF)).toBe(false);
  });
});

describe('isRealEmail', () => {
  it('accepts an ordinary address', () => {
    expect(isRealEmail('teacher@school.edu')).toBe(true);
  });

  it('rejects the synthetic invite-redeem domain', () => {
    expect(isRealEmail('invite-abc123@mochi.local')).toBe(false);
  });

  it('rejects null, empty and malformed input', () => {
    expect(isRealEmail(null)).toBe(false);
    expect(isRealEmail(undefined)).toBe(false);
    expect(isRealEmail('')).toBe(false);
    expect(isRealEmail('not-an-email')).toBe(false);
  });
});

describe('sendEmail', () => {
  it('no-ops without a configured key', async () => {
    const ok = await sendEmail(OFF, { to: 'teacher@school.edu', subject: 's', text: 't' });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('refuses a synthetic address even when enabled', async () => {
    const ok = await sendEmail(ON, { to: 'invite-x@mochi.local', subject: 's', text: 't' });
    expect(ok).toBe(false);
    expect(calls).toHaveLength(0);
  });

  it('posts to Brevo with the configured sender when enabled', async () => {
    const ok = await sendEmail(ON, {
      to: 'teacher@school.edu',
      subject: 'Đặt lại mật khẩu',
      text: 'hello',
    });
    expect(ok).toBe(true);
    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://api.brevo.com/v3/smtp/email');
    expect(calls[0].body.sender.email).toBe('noreply@example.com');
    expect(calls[0].body.to).toEqual([{ email: 'teacher@school.edu' }]);
  });

  it('degrades to false rather than throwing on a network error', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('network down');
      }),
    );
    const ok = await sendEmail(ON, { to: 'teacher@school.edu', subject: 's', text: 't' });
    expect(ok).toBe(false);
  });
});
