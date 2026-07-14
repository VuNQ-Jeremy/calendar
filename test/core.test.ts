import { describe, it, expect } from 'vitest';
import { iso, addDays, makeCode, colorOf, PALETTE } from '../src/lib/core.js';

describe('iso()', () => {
  it('formats single-digit month and day with zero padding', () => {
    expect(iso(new Date(2026, 0, 5))).toBe('2026-01-05');
  });

  it('formats December 31 correctly', () => {
    expect(iso(new Date(2026, 11, 31))).toBe('2026-12-31');
  });

  it('handles year boundary', () => {
    expect(iso(new Date(2025, 11, 31))).toBe('2025-12-31');
    expect(iso(new Date(2026, 0, 1))).toBe('2026-01-01');
  });
});

describe('addDays()', () => {
  it('crosses a month boundary', () => {
    const result = addDays(new Date(2026, 0, 30), 5); // Jan 30 + 5 = Feb 4
    expect(iso(result)).toBe('2026-02-04');
  });

  it('crosses a year boundary', () => {
    const result = addDays(new Date(2025, 11, 29), 5); // Dec 29 + 5 = Jan 3
    expect(iso(result)).toBe('2026-01-03');
  });

  it('works with negative values', () => {
    const result = addDays(new Date(2026, 1, 1), -3); // Feb 1 - 3 = Jan 29
    expect(iso(result)).toBe('2026-01-29');
  });

  it('does not mutate the input date', () => {
    const d = new Date(2026, 0, 10);
    addDays(d, 5);
    expect(iso(d)).toBe('2026-01-10');
  });
});

describe('makeCode()', () => {
  const VALID_CHARS = /^[A-HJ-NP-Z2-9]{3}-[A-HJ-NP-Z2-9]{3}$/;

  it('matches XXX-XXX format with no ambiguous chars across 200 iterations', () => {
    for (let i = 0; i < 200; i++) {
      const code = makeCode();
      expect(code).toMatch(VALID_CHARS);
      // No I, O, 0, 1
      expect(code).not.toMatch(/[IO01]/);
    }
  });

  it('produces codes of length 7 (XXX-XXX)', () => {
    expect(makeCode()).toHaveLength(7);
  });
});

describe('colorOf()', () => {
  it('returns the matching palette entry for a known id', () => {
    const result = colorOf('green');
    expect(result.id).toBe('green');
  });

  it('falls back to the first palette entry for an unknown id', () => {
    const result = colorOf('nonexistent');
    expect(result).toBe(PALETTE[0]);
  });

  it('falls back for undefined', () => {
    const result = colorOf(undefined);
    expect(result).toBe(PALETTE[0]);
  });
});
