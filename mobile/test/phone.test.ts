import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhoneVN } from '@mochi/shared/logic/phone';

/**
 * `@mochi/shared/logic/phone` — the VN phone normalizer the Zalo OTP login flow matches
 * phone numbers with. Covered here too (not just the repo-root suite) because the mobile
 * login screen calls `normalizePhone` client-side before ever hitting the network.
 */

describe('normalizePhone', () => {
  it('normalizes common VN input shapes to the same E.164 value', () => {
    expect(normalizePhone('0901234567')).toBe('+84901234567');
    expect(normalizePhone('090 123-4567')).toBe('+84901234567');
    expect(normalizePhone('84901234567')).toBe('+84901234567');
    expect(normalizePhone('+84901234567')).toBe('+84901234567');
  });

  it('rejects legacy 01xx prefixes and garbage', () => {
    expect(normalizePhone('0121234567')).toBeNull();
    expect(normalizePhone('012345')).toBeNull();
    expect(normalizePhone('')).toBeNull();
    expect(normalizePhone('hello')).toBeNull();
  });

  it('passes through a shaped foreign number unchanged', () => {
    expect(normalizePhone('+15551234567')).toBe('+15551234567');
  });
});

describe('formatPhoneVN', () => {
  it('groups a VN number for display', () => {
    expect(formatPhoneVN('+84901234567')).toBe('0901 234 567');
  });
});
