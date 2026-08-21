import { describe, it, expect } from 'vitest';
import { normalizePhone, formatPhoneVN } from '../shared/logic/phone';

describe('normalizePhone', () => {
  const cases: Array<[string, string | null]> = [
    ['0901234567', '+84901234567'],
    ['090 123-4567', '+84901234567'],
    ['090.123.4567', '+84901234567'],
    ['84901234567', '+84901234567'],
    ['+84901234567', '+84901234567'],
    ['0121234567', null], // legacy 01xx prefix, retired 2018
    ['012345', null],
    ['', null],
    ['hello', null],
    ['+15551234567', '+15551234567'], // foreign number, shape-only check
  ];

  for (const [input, expected] of cases) {
    it(`normalizes ${JSON.stringify(input)} to ${JSON.stringify(expected)}`, () => {
      expect(normalizePhone(input)).toBe(expected);
    });
  }
});

describe('formatPhoneVN', () => {
  it('groups a VN E.164 number for display', () => {
    expect(formatPhoneVN('+84901234567')).toBe('0901 234 567');
  });

  it('passes through a non-VN number unchanged', () => {
    expect(formatPhoneVN('+15551234567')).toBe('+15551234567');
  });
});
