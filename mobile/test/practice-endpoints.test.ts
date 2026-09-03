import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

/**
 * `lib/endpoints.ts` — the Practice calls.
 *
 * What is worth pinning here is the URL and the shape, not the payload: a typo in a path is a 404
 * the student sees as "no tasks yet", which looks exactly like an empty week. The upload path is
 * deliberately NOT covered — it goes through XHR, which `lib/api.ts`'s own tests already exercise.
 */
const ORIGINAL_ENV = process.env.EXPO_PUBLIC_API_URL;

async function loadEndpoints() {
  vi.resetModules();
  process.env.EXPO_PUBLIC_API_URL = 'https://api.example.com';
  const api = await import('../lib/api');
  api.configureApi({ getToken: async () => 'tok123', onUnauthorized: () => {} });
  const endpoints = await import('../lib/endpoints');
  return endpoints;
}

function mockFetch(status: number, body?: unknown) {
  const fn = vi.fn(async (_url: string, _init?: RequestInit) => ({
    ok: status >= 200 && status < 300,
    status,
    text: async () => (body === undefined ? '' : JSON.stringify(body)),
  }));
  globalThis.fetch = fn as unknown as typeof fetch;
  return fn;
}

const urlOf = (fn: ReturnType<typeof mockFetch>, call: number) => fn.mock.calls[call][0];
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

describe('practice endpoints', () => {
  it('reads the tab from GET /api/practice/my with a bearer token, unwrapping { data }', async () => {
    const { practice } = await loadEndpoints();
    const payload = {
      serverNow: '2031-03-03T13:00:00Z',
      todayIct: '2031-03-03',
      classes: [],
      tasks: [],
    };
    const fetchMock = mockFetch(200, { data: payload });

    await expect(practice.my()).resolves.toEqual(payload);
    expect(urlOf(fetchMock, 0)).toBe('https://api.example.com/api/practice/my');
    expect(initOf(fetchMock, 0).headers).toMatchObject({ Authorization: 'Bearer tok123' });
  });

  it('posts an excuse request as JSON', async () => {
    const { practice } = await loadEndpoints();
    const fetchMock = mockFetch(200, { data: { id: 'e1', status: 'pending' } });

    await practice.requestExcuse({ classId: 'c1', date: '2031-03-04', reason: 'Sick' });
    expect(urlOf(fetchMock, 0)).toBe('https://api.example.com/api/practice/excuse');
    const init = initOf(fetchMock, 0);
    expect(init.method).toBe('POST');
    expect(JSON.parse(String(init.body))).toEqual({
      classId: 'c1',
      date: '2031-03-04',
      reason: 'Sick',
    });
  });
});
