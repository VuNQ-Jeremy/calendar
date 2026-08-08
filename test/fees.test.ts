import { describe, it, expect } from 'vitest';
import { resolveMemo, vietQrUrl } from '../shared/logic/fees';
import { formatVnd, studentFees, paymentStatus } from '../shared/logic/tuition';

/**
 * The payment-info helpers, plus a guard on the compatibility barrel.
 *
 * `shared/logic/tuition.ts` re-exports everything that moved to `./fees` so the web call sites and
 * the existing tuition tests keep compiling. That re-export is easy to drop by accident during a
 * later tidy-up, and nothing else would notice until a build broke, so it is asserted here.
 */

describe('resolveMemo', () => {
  it('fills the template a parent will read in their banking app', () => {
    expect(resolveMemo('HP {month} {name}', { month: '2026-07', name: 'Trần Thị Bích' })).toBe(
      'HP 7/2026 Trần Thị Bích',
    );
  });

  it('uses the numeric month, not the "Tháng 7" label', () => {
    // A memo saying "HP Tháng 7 2026" wastes characters in a field banks truncate.
    expect(resolveMemo('{month}', { month: '2026-01', name: 'x' })).toBe('1/2026');
  });

  it('replaces every occurrence and trims', () => {
    expect(resolveMemo('  {name} {name} ', { month: '2026-07', name: 'An' })).toBe('An An');
  });

  it('leaves a template with no placeholders alone', () => {
    expect(resolveMemo('Hoc phi', { month: '2026-07', name: 'An' })).toBe('Hoc phi');
  });
});

describe('vietQrUrl', () => {
  const base = {
    bankCode: 'VCB',
    accountNumber: '0011234567',
    accountHolder: 'NGUYEN VAN A',
    amountVnd: 800000,
    memo: 'HP 7/2026 Trần Thị Bích',
  };

  it('builds a compact2 image URL with the amount and memo prefilled', () => {
    const url = new URL(vietQrUrl(base));
    expect(url.origin + url.pathname).toBe(
      'https://img.vietqr.io/image/VCB-0011234567-compact2.png',
    );
    expect(url.searchParams.get('amount')).toBe('800000');
    // Round-trips through the URL parser: diacritics must survive to the banking app.
    expect(url.searchParams.get('addInfo')).toBe('HP 7/2026 Trần Thị Bích');
    expect(url.searchParams.get('accountName')).toBe('NGUYEN VAN A');
  });

  it('never emits a negative or fractional amount', () => {
    expect(new URL(vietQrUrl({ ...base, amountVnd: -5 })).searchParams.get('amount')).toBe('0');
    expect(new URL(vietQrUrl({ ...base, amountVnd: 1500.6 })).searchParams.get('amount')).toBe(
      '1501',
    );
  });
});

describe('the tuition compatibility barrel', () => {
  it('still re-exports what the web imports from it', () => {
    expect(formatVnd(1500000)).toBe('1.500.000 ₫');
    expect(paymentStatus(1000, 400)).toBe('partial');
    expect(studentFees([], [])).toEqual([]);
  });
});
