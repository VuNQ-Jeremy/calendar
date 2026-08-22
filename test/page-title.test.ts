import { describe, it, expect } from 'vitest';
import { titleForPath, titleKeyForPath } from '../src/lib/page-title.js';
import { NAV } from '../src/lib/sidebar-nav.jsx';

describe('titleForPath', () => {
  it('names the page after its nav row', () => {
    expect(titleForPath('/feedback')).toBe('Mochi — Feedback');
    expect(titleForPath('/dashboard')).toBe('Mochi — Dashboard');
  });

  it('falls back to the parent page for a detail route', () => {
    expect(titleForPath('/tests/42')).toBe('Mochi — Tests');
    expect(titleForPath('/garden/5/album/2026-08')).toBe('Mochi — Garden');
    expect(titleForPath('/children/17/2026-08')).toBe('Mochi — My children');
  });

  it('matches whole segments, so a longer path is not a child of a shorter one', () => {
    expect(titleForPath('/garden-species')).toBe('Mochi — Plants');
    expect(titleForPath('/my-tests')).toBe('Mochi — My tests');
  });

  it('prefers the most specific entry', () => {
    expect(titleForPath('/logs')).toBe('Mochi — Logs');
    expect(titleForPath('/logs/usage')).toBe('Mochi — Usage');
    expect(titleForPath('/logs/activity')).toBe('Mochi — Activity');
    // A student filter is not a sub-page, so it keeps the /logs title.
    expect(titleForPath('/logs/17')).toBe('Mochi — Logs');
  });

  it('titles the pages that have no nav row', () => {
    expect(titleForPath('/login')).toBe('Mochi — Sign in');
    expect(titleForPath('/profile')).toBe('Mochi — Your profile');
  });

  it('brands anything that is not a page in the app shell', () => {
    // The landing page (its own meta wins anyway), the print documents, the share cards.
    expect(titleForPath('/')).toBe('Mochi — School OS');
    expect(titleForPath('/tests/42/print')).toBe('Mochi — Tests'); // nearest page still wins
    expect(titleForPath('/zalo-media/zalo/abc.png')).toBe('Mochi — School OS');
  });

  it('translates', () => {
    expect(titleForPath('/feedback', 'vi')).toBe('Mochi — Phản hồi');
    expect(titleForPath('/', 'vi')).toBe('Mochi — School OS');
  });

  it('ignores a trailing slash', () => {
    expect(titleForPath('/feedback/')).toBe('Mochi — Feedback');
  });

  // The guard that keeps this file honest: a nav row added later gets a tab title or fails here.
  it('resolves every nav path', () => {
    for (const sec of NAV) {
      for (const item of sec.items) {
        if (item.external) continue;
        expect(titleKeyForPath(item.path), item.path).not.toBeNull();
      }
    }
  });
});
