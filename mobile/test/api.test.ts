import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `lib/api.ts` — the only place in the app that talks HTTP.
 *
 * Two things here are worth more than the rest of the file combined:
 *
 *   1. **`BASE` is computed at import time.** Publish an OTA update without EXPO_PUBLIC_API_URL
 *      in the EAS environment and `extra.apiUrl` arrives as `{}` — `{}.replace` threw BEFORE THE
 *      FIRST FRAME on 2026-07-29, expo-updates silently rolled back, and the update looked like
 *      it had never shipped. The `typeof` guard added in response is asserted below.
 *   2. **401 signs the user out; 403 must not.** A 403 means the token is valid and the role is
 *      wrong. Signing someone out for it would be both wrong and baffling.
 *
 * Because `BASE` is module scope, every case re-imports the module rather than importing it once
 * at the top — hence `loadApi()`.
 */

const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_URL;

/**
 * Re-import `lib/api.ts` with a chosen environment.
 *
 * `env: null` removes the variable entirely (the OTA case, where only `extra.apiUrl` is left).
 * `extra` replaces `Constants.expoConfig`, so a test can hand it the `{}` that caused the crash.
 */
async function loadApi(opts: { env?: string | null; extra?: unknown } = {}) {
  vi.resetModules();

  if (opts.env === null) delete process.env.EXPO_PUBLIC_API_URL;
  else if (opts.env !== undefined) process.env.EXPO_PUBLIC_API_URL = opts.env;

  if ('extra' in opts) {
    const Constants = (await import('./stubs/expo-constants')).default;
    Constants.expoConfig = opts.extra === undefined ? null : { extra: opts.extra as never };
  }

  return import('../lib/api');
}

/** A `fetch` that answers with the given status and body, and records what it was called with. */
function mockFetch(status: number, body?: unknown, init: { text?: string } = {}) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => {
    const text = init.text ?? (body === undefined ? '' : JSON.stringify(body));
    return {
      ok: status >= 200 && status < 300,
      status,
      text: async () => text,
    } as unknown as Response;
  });
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

/** The `RequestInit` a recorded `fetch` call was made with. */
const initOf = (fn: ReturnType<typeof mockFetch>, call: number) =>
  fn.mock.calls[call][1] as RequestInit;

beforeEach(() => {
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com';
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.EXPO_PUBLIC_API_URL;
  else process.env.EXPO_PUBLIC_API_URL = ORIGINAL_ENV;
  vi.restoreAllMocks();
});

describe('BASE', () => {
  it('strips a trailing slash so paths do not double up', async () => {
    const { BASE } = await loadApi({ env: 'https://api.example.com/' });
    expect(BASE).toBe('https://api.example.com');
  });

  it('falls back to the value app.config.ts inlined', async () => {
    const { BASE } = await loadApi({ env: null, extra: { apiUrl: 'https://from-config.test/' } });
    expect(BASE).toBe('https://from-config.test');
  });

  it('survives the OTA publish that inlines a non-string apiUrl', async () => {
    // THE 2026-07-29 REGRESSION. Importing must not throw; `{}.replace` did.
    const { BASE } = await loadApi({ env: null, extra: { apiUrl: {} } });
    expect(BASE).toBe('');
  });

  it('survives an expoConfig that is missing altogether', async () => {
    const { BASE } = await loadApi({ env: null, extra: undefined });
    expect(BASE).toBe('');
  });

  it('fails every call visibly, rather than at import, when there is no base URL', async () => {
    const { apiFetch, ApiError } = await loadApi({ env: null, extra: { apiUrl: {} } });
    await expect(apiFetch('/anything')).rejects.toMatchObject({
      constructor: ApiError,
      status: 0,
      code: 'no_base_url',
    });
  });
});

describe('request building', () => {
  it('joins a path that has no leading slash', async () => {
    const { apiFetch } = await loadApi();
    const fetchMock = mockFetch(200, { data: null });
    await apiFetch('classes');
    expect(fetchMock.mock.calls[0][0]).toBe('https://api.example.com/classes');
  });

  it('skips null and undefined query values but keeps false and 0', async () => {
    const { apiFetch } = await loadApi();
    const fetchMock = mockFetch(200, { data: null });
    await apiFetch('/events', {
      query: { from: '2026-01-01', to: null, cursor: undefined, all: false, page: 0 },
    });
    expect(fetchMock.mock.calls[0][0]).toBe(
      'https://api.example.com/events?from=2026-01-01&all=false&page=0',
    );
  });

  it('sends the bearer token when the call is authed, and omits it when it is not', async () => {
    const { apiFetch, configureApi } = await loadApi();
    configureApi({ getToken: async () => 'tok123', onUnauthorized: () => {} });

    const fetchMock = mockFetch(200, { data: null });
    await apiFetch('/me');
    expect(initOf(fetchMock, 0).headers).toMatchObject({
      Authorization: 'Bearer tok123',
    });

    await apiFetch('/login', { auth: false });
    expect(initOf(fetchMock, 1).headers).not.toHaveProperty('Authorization');
  });

  it('does not set Content-Type for FormData, so RN can generate the boundary', async () => {
    const { apiFetch } = await loadApi();
    const fetchMock = mockFetch(200, { data: null });

    await apiFetch('/upload', { method: 'POST', body: new FormData() });
    expect(initOf(fetchMock, 0).headers).not.toHaveProperty('Content-Type');

    await apiFetch('/classes', { method: 'POST', body: { name: 'x' } });
    expect(initOf(fetchMock, 1).headers).toMatchObject({
      'Content-Type': 'application/json',
    });
  });
});

describe('responses', () => {
  it('unwraps the data envelope', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(200, { data: { id: 'c1', name: 'Biology 9A' } });
    expect(await apiFetch('/classes/c1')).toEqual({ id: 'c1', name: 'Biology 9A' });
  });

  it('returns without parsing on a 204', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(204);
    expect(await apiFetch('/classes/c1', { method: 'DELETE' })).toBeUndefined();
  });

  it('reports HTML from the SSR shell as a server error, not a parse crash', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(200, undefined, { text: '<!doctype html><html></html>' });
    await expect(apiFetch('/classes')).rejects.toMatchObject({
      code: 'non_json_response',
      messageKey: 'm_server_error',
    });
  });

  it('carries the envelope error code and validation issues through', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(400, { error: 'validation_failed', issues: [{ path: ['name'] }] });
    await expect(apiFetch('/classes', { method: 'POST', body: {} })).rejects.toMatchObject({
      status: 400,
      code: 'validation_failed',
      messageKey: 'err_generic_msg',
      issues: [{ path: ['name'] }],
    });
  });

  it('synthesises a code when the body has none', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(418, {});
    await expect(apiFetch('/x')).rejects.toMatchObject({ code: 'http_418' });
  });
});

describe('the session boundary', () => {
  it('signs the user out on a 401', async () => {
    const { apiFetch, configureApi } = await loadApi();
    const onUnauthorized = vi.fn();
    configureApi({ getToken: async () => 'tok', onUnauthorized });
    mockFetch(401, { error: 'unauthorized' });

    await expect(apiFetch('/me')).rejects.toMatchObject({ messageKey: 'm_session_expired' });
    expect(onUnauthorized).toHaveBeenCalledTimes(1);
  });

  it('does NOT sign the user out on a 403 — the token is fine, the role is not', async () => {
    const { apiFetch, configureApi } = await loadApi();
    const onUnauthorized = vi.fn();
    configureApi({ getToken: async () => 'tok', onUnauthorized });
    mockFetch(403, { error: 'forbidden' });

    await expect(apiFetch('/admin')).rejects.toMatchObject({ messageKey: 'err_forbidden_msg' });
    expect(onUnauthorized).not.toHaveBeenCalled();
  });
});

describe('transport failures', () => {
  it('tells a timeout apart from a dead network', async () => {
    const { apiFetch } = await loadApi();

    const aborted = Object.assign(new Error('aborted'), { name: 'AbortError' });
    globalThis.fetch = vi.fn(async () => {
      throw aborted;
    }) as unknown as typeof fetch;
    await expect(apiFetch('/slow')).rejects.toMatchObject({
      status: 0,
      code: 'timeout',
      messageKey: 'm_timeout',
    });

    globalThis.fetch = vi.fn(async () => {
      throw new TypeError('Network request failed');
    }) as unknown as typeof fetch;
    await expect(apiFetch('/anything')).rejects.toMatchObject({
      status: 0,
      code: 'network_error',
      messageKey: 'm_offline',
    });
  });

  it('maps a 5xx onto the server-error message', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(503, { error: 'unavailable' });
    await expect(apiFetch('/x')).rejects.toMatchObject({ messageKey: 'm_server_error' });
  });

  it('maps a 404 onto its own message', async () => {
    const { apiFetch } = await loadApi();
    mockFetch(404, { error: 'not_found' });
    await expect(apiFetch('/gone')).rejects.toMatchObject({ messageKey: 'err_not_found_msg' });
  });
});
