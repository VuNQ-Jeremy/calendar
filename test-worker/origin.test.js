import { describe, it, expect } from 'vitest';
import { appOrigin, isAppHost, appUrl } from '../server/origin';

describe('appOrigin', () => {
  it('is null when APP_ORIGIN is unset', () => {
    expect(appOrigin({})).toBeNull();
  });

  it('is null for an empty or whitespace-only value', () => {
    expect(appOrigin({ APP_ORIGIN: '' })).toBeNull();
    expect(appOrigin({ APP_ORIGIN: '   ' })).toBeNull();
  });

  it('is null for a malformed URL — a bad var must never take the site down', () => {
    expect(appOrigin({ APP_ORIGIN: 'not a url' })).toBeNull();
  });

  it('normalizes to the origin, dropping any path', () => {
    expect(appOrigin({ APP_ORIGIN: 'https://app.example.com/' })).toBe('https://app.example.com');
    expect(appOrigin({ APP_ORIGIN: 'https://app.example.com/some/path' })).toBe(
      'https://app.example.com',
    );
  });
});

describe('isAppHost', () => {
  it('is true for every host when APP_ORIGIN is unset (single-host mode)', () => {
    const env = {};
    expect(isAppHost(new Request('https://calendar.ngqv0712.workers.dev/'), env)).toBe(true);
    expect(isAppHost(new Request('https://app.example.com/'), env)).toBe(true);
    expect(isAppHost(new Request('https://example.com/'), env)).toBe(true);
  });

  it('is true on the configured app host', () => {
    const env = { APP_ORIGIN: 'https://app.example.com' };
    expect(isAppHost(new Request('https://app.example.com/'), env)).toBe(true);
  });

  it('is true on workers.dev even when APP_ORIGIN is set — old users and the mobile app stay working', () => {
    const env = { APP_ORIGIN: 'https://app.example.com' };
    expect(isAppHost(new Request('https://calendar.ngqv0712.workers.dev/'), env)).toBe(true);
  });

  it('is false on the marketing apex once APP_ORIGIN is set', () => {
    const env = { APP_ORIGIN: 'https://app.example.com' };
    expect(isAppHost(new Request('https://example.com/'), env)).toBe(false);
  });

  it('falls back to single-host mode when APP_ORIGIN is malformed', () => {
    const env = { APP_ORIGIN: 'not a url' };
    expect(isAppHost(new Request('https://example.com/'), env)).toBe(true);
  });
});

describe('appUrl', () => {
  it('returns the path unchanged when APP_ORIGIN is unset', () => {
    expect(appUrl({}, '/login')).toBe('/login');
  });

  it('prefixes the app origin when APP_ORIGIN is set', () => {
    expect(appUrl({ APP_ORIGIN: 'https://app.example.com' }, '/login')).toBe(
      'https://app.example.com/login',
    );
  });
});
