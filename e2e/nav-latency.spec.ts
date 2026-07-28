import { test, expect, type Page, type Request } from '@playwright/test';

/**
 * Verifies the navigation-latency work (docs/navigation-latency-plan.md) in a
 * real browser against a real deployment — the parts the unit suites cannot
 * see: whether a navigation actually skips the network, whether hovering
 * prefetches, and whether the pending UI appears only when it should.
 *
 * Run:  MOCHI_EMAIL=... MOCHI_PASSWORD=... npm run test:e2e
 *
 * STILL MANUAL (both need writes to the live database, so they are deliberately
 * not automated against production):
 *   - Offline retry storm: make a route stale via a mutation elsewhere, go
 *     offline, open the stale route -> exactly ONE failed .data request, not a
 *     stream. (The underlying guard is unit-tested: "does not notify
 *     subscribers when the background refresh fails" in test/cache.test.ts.)
 *   - homework <-> assessments coupling: save a homework grade -> the score
 *     shows on /assessments; delete that score -> /homework shows ungraded.
 */

const EMAIL = process.env.MOCHI_EMAIL;
const PASSWORD = process.env.MOCHI_PASSWORD;
const HAVE_CREDS = Boolean(EMAIL && PASSWORD);

/** Single-fetch data requests, as pathname+search (e.g. "/people.data?_routes=..."). */
function dataRequestRecorder(page: Page) {
  const seen: string[] = [];
  const onRequest = (r: Request) => {
    const u = new URL(r.url());
    if (u.pathname.endsWith('.data')) seen.push(u.pathname + u.search);
  };
  page.on('request', onRequest);
  return {
    seen,
    stop: () => page.off('request', onRequest),
  };
}

/** Run `fn`, then wait for the network to settle, and report any .data fetches. */
async function recordDataRequests(page: Page, fn: () => Promise<void>, settleMs = 1500) {
  const rec = dataRequestRecorder(page);
  try {
    await fn();
    await page.waitForTimeout(settleMs);
  } finally {
    rec.stop();
  }
  return rec.seen;
}

async function clickNav(page: Page, href: string) {
  await page.click(`.sb a[href="${href}"]`);
  await expect(page).toHaveURL(new RegExp(`${href}(\\?|$)`));
}

test.describe('navigation latency', () => {
  test.skip(!HAVE_CREDS, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run these');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('form[action="/login"] button[type="submit"]');
    // Staff land on /dashboard, students on /flashcards.
    await page.waitForURL(/\/(dashboard|flashcards)/, { timeout: 30_000 });
    await expect(page.locator('.sb')).toBeVisible();
    // Every assertion below drives the staff sidebar.
    const isStaff = (await page.locator('.sb a[href="/dashboard"]').count()) > 0;
    test.skip(!isStaff, 'MOCHI_EMAIL must be a staff account');
    if (!page.url().includes('/dashboard')) await clickNav(page, '/dashboard');
    await page.waitForLoadState('networkidle');
  });

  // Control: proves the recorder actually observes .data traffic, so the
  // "fetches nothing" assertions below cannot pass for the wrong reason.
  test('a cold route does fetch its .data', async ({ page }) => {
    const reqs = await recordDataRequests(page, () => clickNav(page, '/people'));
    expect(
      reqs.some((u) => u.startsWith('/people.data')),
      `expected a /people.data fetch, saw: ${reqs.join(', ') || '(none)'}`,
    ).toBe(true);
  });

  // Hydrate seeding + SWR: the route visited on document load is already
  // cached, so coming back to it must not touch the network at all.
  test('returning to an already-visited route fetches nothing', async ({ page }) => {
    await clickNav(page, '/calendar');
    await page.waitForLoadState('networkidle');
    const reqs = await recordDataRequests(page, () => clickNav(page, '/dashboard'));
    expect(reqs, `expected no .data requests, saw: ${reqs.join(', ')}`).toEqual([]);
  });

  // shouldRevalidate: a plain GET must not refetch the layout's badge counts.
  test('clicking the current page link does not refetch the layout', async ({ page }) => {
    const reqs = await recordDataRequests(page, async () => {
      await page.click('.sb a[href="/dashboard"]');
    });
    expect(reqs, `expected no .data requests, saw: ${reqs.join(', ')}`).toEqual([]);
  });

  // prefetch="intent" warms the JS chunks. React Router deliberately does NOT
  // prefetch data for routes that have a clientLoader, so .data must stay quiet.
  test('hovering a nav link prefetches its chunks but not its data', async ({ page }) => {
    const assets: string[] = [];
    const onRequest = (r: Request) => {
      const p = new URL(r.url()).pathname;
      if (p.startsWith('/assets/')) assets.push(p);
    };
    page.on('request', onRequest);
    const data = await recordDataRequests(page, async () => {
      await page.hover('.sb a[href="/homework"]');
    });
    page.off('request', onRequest);

    expect(
      assets.some((p) => p.includes('homework')),
      `expected a homework chunk to preload, saw: ${assets.join(', ') || '(none)'}`,
    ).toBe(true);
    expect(data.filter((u) => u.startsWith('/homework.data'))).toEqual([]);
  });

  test('a slow navigation shows the progress bar and marks the link pending', async ({ page }) => {
    // Delay the target's data so the 150 ms threshold is crossed deterministically.
    await page.route('**/people.data*', async (route) => {
      await new Promise((r) => setTimeout(r, 2500));
      await route.continue();
    });

    await page.click('.sb a[href="/people"]');
    await expect(page.locator('.nav-progress')).toBeVisible({ timeout: 5_000 });
    await expect(page.locator('.sb a[href="/people"].is-pending')).toHaveCount(1);

    await expect(page).toHaveURL(/\/people(\?|$)/, { timeout: 30_000 });
    await expect(page.locator('.nav-progress')).toHaveCount(0);
    await expect(page.locator('.sb a.is-pending')).toHaveCount(0);
  });

  // The 150 ms delay exists so instant (cached) navigations never flash the bar.
  test('a cache-hit navigation never flashes the progress bar', async ({ page }) => {
    await clickNav(page, '/calendar');
    await page.waitForLoadState('networkidle');

    await page.evaluate(() => {
      const w = window as Window & { __navBarSeen?: boolean };
      w.__navBarSeen = false;
      new MutationObserver(() => {
        if (document.querySelector('.nav-progress')) w.__navBarSeen = true;
      }).observe(document.body, { childList: true, subtree: true });
    });

    await clickNav(page, '/dashboard');
    await page.waitForTimeout(900);

    const flashed = await page.evaluate(
      () => (window as Window & { __navBarSeen?: boolean }).__navBarSeen,
    );
    expect(flashed, 'progress bar appeared during an instant cached navigation').toBe(false);
  });
});
