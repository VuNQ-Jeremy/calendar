import {
  test,
  expect,
  request as pwRequest,
  type Page,
  type APIRequestContext,
} from '@playwright/test';

/**
 * Live updates (workers/live-hub.ts) against a real deployment.
 *
 * What only an end-to-end run can show: a browser tab that nobody touched
 * refreshing itself because the data changed somewhere else. The mutations are
 * driven through the JSON API rather than a second browser, which keeps the
 * test about the broadcast and additionally covers the path that matters most
 * in practice — a write from the phone reaching an open browser tab.
 *
 *   MOCHI_EMAIL=... MOCHI_PASSWORD=... npm run test:e2e
 *
 * Every spec writes to the live database and deletes what it created.
 */

const EMAIL = process.env.MOCHI_EMAIL;
const PASSWORD = process.env.MOCHI_PASSWORD;
const STUDENT_EMAIL = process.env.MOCHI_STUDENT_EMAIL;
const STUDENT_PASSWORD = process.env.MOCHI_STUDENT_PASSWORD ?? PASSWORD;
const HAVE_CREDS = Boolean(EMAIL && PASSWORD);

async function signIn(page: Page, email: string, password: string) {
  // Sidebar sections default to collapsed, which would hide the /calendar row
  // clicked below and the /feedback badge this spec polls (innerText on a
  // hidden node returns ''). Seed "nothing collapsed" before first paint —
  // collapse behaviour itself is e2e/sidebar-collapse.spec.ts's business.
  await page.addInitScript(() => localStorage.setItem('mochi_sb_collapsed_v1', '[]'));
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('form[action="/login"] button[type="submit"]');
  await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
  await expect(page.locator('.sb')).toBeVisible();
}

/** An API client holding a mobile bearer token — the /api/* routes reject cookies. */
async function apiClient(baseURL: string): Promise<APIRequestContext> {
  const anon = await pwRequest.newContext({ baseURL });
  const res = await anon.post('/api/auth/login', {
    data: { email: EMAIL, password: PASSWORD },
  });
  const body = await res.json();
  expect(res.status(), JSON.stringify(body)).toBe(200);
  await anon.dispose();
  return pwRequest.newContext({
    baseURL,
    extraHTTPHeaders: { Authorization: `Bearer ${body.data.token}` },
  });
}

/**
 * Record the live socket and every invalidate message it receives.
 *
 * Must be attached before the page navigates: the socket opens as soon as the
 * app shell mounts, and Playwright only reports sockets opened after the
 * listener is registered. Keepalive pongs are not JSON and fall through.
 */
function recordLive(page: Page) {
  const opened: string[] = [];
  const domains: string[] = [];
  page.on('websocket', (ws) => {
    opened.push(ws.url());
    ws.on('framereceived', (frame) => {
      try {
        const msg = JSON.parse(frame.payload as string);
        if (msg?.type === 'invalidate') domains.push(msg.domain);
      } catch {
        // 'pong' or anything else that is not our protocol.
      }
    });
  });
  return { opened, domains };
}

async function waitForSocket(page: Page, live: { opened: string[] }) {
  await expect
    .poll(() => live.opened.length, { timeout: 20_000, message: 'live socket never opened' })
    .toBeGreaterThan(0);
  expect(live.opened[0]).toMatch(/\/ws$/);
  // Playwright reports the socket when the request goes out, a moment before
  // the hub has accepted it. Broadcasting into that gap loses the message —
  // barely matters in real use, but it makes these specs flaky.
  await page.waitForTimeout(1500);
}

test.describe('live updates', () => {
  test.skip(!HAVE_CREDS, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run these');

  test('an event created elsewhere appears without navigating', async ({ page, baseURL }) => {
    const title = `live-e2e ${Date.now()}`;
    const api = await apiClient(baseURL!);

    const live = recordLive(page);
    await signIn(page, EMAIL!, PASSWORD!);
    await page.click('.sb a[href="/calendar"]');
    await expect(page).toHaveURL(/\/calendar/);
    await waitForSocket(page, live);

    // The calendar renders the viewer's LOCAL week, so an event stamped with
    // the UTC date can land outside it — the school runs at UTC+7.
    const today = await page.evaluate(() => new Date().toLocaleDateString('en-CA'));

    const refetches: string[] = [];
    page.on('request', (r) => {
      if (new URL(r.url()).pathname === '/calendar.data') refetches.push(r.url());
    });

    const created = await api.post('/api/events', {
      data: { title, date: today, start: '09:00', end: '10:00' },
    });
    const body = await created.json();
    expect(created.status(), JSON.stringify(body)).toBe(200);
    const id = body.data.id;

    try {
      // The broadcast reached this tab...
      await expect.poll(() => live.domains, { timeout: 20_000 }).toContain('calendar');
      // ...it refetched off the back of it...
      await expect.poll(() => refetches.length, { timeout: 20_000 }).toBeGreaterThan(0);
      // ...and re-rendered on its own: no reload, no navigation, no click.
      await expect(page.getByText(title, { exact: false }).first()).toBeVisible({
        timeout: 20_000,
      });
    } finally {
      await api.delete(`/api/events?id=${id}`);
      await api.dispose();
    }
  });

  /**
   * The layout loader is normally skipped for revalidator-driven revalidations,
   * so the badge counts would sit still even though the route data refreshed.
   * The isLiveLayoutRefreshPending exception in app/routes/_app.tsx is what
   * makes this work, and it is the easiest part of the feature to break — a
   * read-once version of that flag looks correct and silently does nothing.
   */
  test('a sidebar badge moves when the count changes elsewhere', async ({ page, baseURL }) => {
    const api = await apiClient(baseURL!);

    const live = recordLive(page);
    await signIn(page, EMAIL!, PASSWORD!);
    await waitForSocket(page, live);

    const badge = page.locator('.sb a[href="/feedback"] .count');
    const readBadge = async () =>
      (await badge.count()) === 0 ? 0 : Number((await badge.innerText()).trim());
    const before = await readBadge();

    const created = await api.post('/api/feedback', {
      data: { message: `live-e2e badge ${Date.now()}`, category: 'other' },
    });
    const body = await created.json();
    expect(created.status(), JSON.stringify(body)).toBe(200);

    try {
      await expect.poll(readBadge, { timeout: 25_000 }).toBe(before + 1);
    } finally {
      await api.delete(`/api/feedback?id=${body.data.id}`);
      await api.dispose();
    }
  });

  test('a staff-only domain never reaches a student socket', async ({ page, baseURL }) => {
    test.skip(!STUDENT_EMAIL, 'Set MOCHI_STUDENT_EMAIL to run this');
    const api = await apiClient(baseURL!);

    const live = recordLive(page);
    await signIn(page, STUDENT_EMAIL!, STUDENT_PASSWORD!);
    await waitForSocket(page, live);

    const created = await api.post('/api/feedback', {
      data: { message: `live-e2e student isolation ${Date.now()}`, category: 'other' },
    });
    const body = await created.json();
    expect(created.status(), JSON.stringify(body)).toBe(200);

    try {
      // Generous: the staff broadcast has long since gone out by now.
      await page.waitForTimeout(6_000);
      expect(live.domains, 'students must not receive staff-only domains').not.toContain(
        'feedback',
      );
    } finally {
      await api.delete(`/api/feedback?id=${body.data.id}`);
      await api.dispose();
    }
  });
});
