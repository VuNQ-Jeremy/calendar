import { describe, it, expect } from 'vitest';
import { agoLabel, shortDate } from '../lib/format';

/**
 * `lib/format.ts` — the relative-time and short-date labels.
 *
 * The unit boundaries are the whole point: `agoLabel` picks between four separate i18n strings
 * rather than one interpolated template, because Vietnamese's zero case ("vừa xong") has no
 * number in it at all. Getting a boundary wrong shows a student "0 min ago".
 */

/** Stands in for the i18n `t()`: returns the key, with the count appended when there is one. */
const t = (key: string, vars?: Record<string, string | number>) =>
  vars ? `${key}:${vars.n}` : key;

const NOW = new Date('2026-01-01T12:00:00.000Z');
const agoBy = (ms: number) => agoLabel(t, new Date(NOW.getTime() - ms).toISOString(), NOW);

describe('agoLabel', () => {
  it('has no number in the "just now" case', () => {
    expect(agoBy(0)).toBe('m_ago_now');
    // The elapsed minutes are ROUNDED, not floored, so "just now" ends at 30s rather than 60s.
    expect(agoBy(29_000)).toBe('m_ago_now');
  });

  it('switches to minutes once the age rounds up to one', () => {
    expect(agoBy(30_000)).toBe('m_ago_min:1');
    expect(agoBy(60_000)).toBe('m_ago_min:1');
    expect(agoBy(59 * 60_000)).toBe('m_ago_min:59');
  });

  it('switches to hours at exactly one hour, and to days at 24', () => {
    expect(agoBy(60 * 60_000)).toBe('m_ago_hour:1');
    expect(agoBy(23 * 60 * 60_000)).toBe('m_ago_hour:23');
    expect(agoBy(24 * 60 * 60_000)).toBe('m_ago_day:1');
  });

  it('never reports a negative age for a clock that is behind the server', () => {
    expect(agoLabel(t, new Date(NOW.getTime() + 60_000).toISOString(), NOW)).toBe('m_ago_now');
  });

  it('renders nothing at all for a missing or unparseable timestamp', () => {
    expect(agoLabel(t, null, NOW)).toBe('');
    expect(agoLabel(t, 'not a date', NOW)).toBe('');
  });
});

describe('shortDate', () => {
  it('formats a day the way the web results row does', () => {
    expect(shortDate('2026-03-04T00:00:00.000Z', 'en-US')).toBe('Mar 4');
  });

  it('falls back to the ISO day rather than throwing on a bad locale', () => {
    expect(shortDate('2026-03-04T00:00:00.000Z', 'not-a-locale!')).toBe('2026-03-04');
  });
});
