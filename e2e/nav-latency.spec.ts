import { test, expect, type Page, type Request } from '@playwright/test';
import { expandAllNavSections, openConfigEntry } from './crud-helpers';

/**
 * The idempotent /config write these tests use to stale the cache: re-pick the scrollbar preset
 * that is already active, which rewrites settings['ui-prefs'] with its current value. The presets
 * live behind /config's Scrollbar style row, so the modal has to be opened and closed again.
 */
async function rewriteUiPrefs(page: Page) {
  const dlg = await openConfigEntry(page, 'Scrollbar style');
  await dlg.locator('button.preset.preset--sb.is-active').click();
  await page.keyboard.press('Escape');
  await expect(dlg).toHaveCount(0);
}

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
 *   - tests <-> assessments coupling: save a paper test score -> the score shows
 *     on /assessments; delete that score -> the test shows ungraded.
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

/**
 * Keep only the requests that load a given route's own data.
 *
 * Single fetch tags each request with `_routes`, and a request for
 * `_routes=routes/_app` is the *layout* loader, not the page: mutations under
 * APP_DATA_MUTATION_PATHS legitimately revalidate the sidebar badge counts, and
 * React Router may attach that pending revalidation to whichever navigation
 * happens next. Filtering by route id keeps these assertions about the route
 * cache rather than about the layout's revalidation policy.
 */
function scopedTo(requests: string[], routeId: string) {
  return requests.filter((u) => u.includes(`_routes=routes%2F${routeId}`));
}

test.describe('navigation latency', () => {
  test.skip(!HAVE_CREDS, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run these');

  test.beforeEach(async ({ page }) => {
    await page.goto('/login');
    await page.fill('input[name="email"]', EMAIL!);
    await page.fill('input[name="password"]', PASSWORD!);
    await page.click('form[action="/login"] button[type="submit"]');
    // Staff land on /dashboard, students on /vocabulary.
    await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
    await expect(page.locator('.sb')).toBeVisible();
    // Every assertion below drives the staff sidebar.
    const isStaff = (await page.locator('.sb a[href="/dashboard"]').count()) > 0;
    test.skip(!isStaff, 'MOCHI_EMAIL must be a staff account');
    if (!page.url().includes('/dashboard')) await clickNav(page, '/dashboard');
    await page.waitForLoadState('networkidle');
    // A load expands only the section owning the current route, and the
    // assertions below click and hover rows across several of them (/people,
    // /questions, /calendar). Open them all by clicking the headers — these
    // tests are about latency, not collapse state, which
    // e2e/sidebar-collapse.spec.ts covers. Must come after the goto above,
    // since a full load resets the sections.
    await expandAllNavSections(page);
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
      await page.hover('.sb a[href="/questions"]');
    });
    page.off('request', onRequest);

    expect(
      assets.some((p) => p.includes('questions')),
      `expected a questions chunk to preload, saw: ${assets.join(', ') || '(none)'}`,
    ).toBe(true);
    expect(data.filter((u) => u.startsWith('/questions.data'))).toEqual([]);
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

  // The bug this guards: swrLoad used to re-flag a failed refresh with
  // markStale(), which notifies -> useStaleRouteRefresh revalidates -> refetch
  // -> fails -> notifies -> one .data request per round trip, forever, while
  // the user sits on the route. markStaleQuiet() restores the flag silently.
  test('a failed background refresh does not retry-storm', async ({ page, context }) => {
    // Cache /assessments (and load its chunk, so navigating to it works offline).
    await clickNav(page, '/assessments');
    await page.waitForLoadState('networkidle');

    // Stale it via the idempotent /config write (see the scoped test below).
    // Profile's "Save changes" would stale everything but stays disabled until
    // the form is dirty, so it cannot be used without changing real data.
    await clickNav(page, '/config');
    await rewriteUiPrefs(page);
    await page.waitForLoadState('networkidle');

    // Settle somewhere neutral and let the layout revalidation that the /config
    // mutation triggered actually finish. React Router queues it in an effect,
    // so networkidle can resolve before it even starts; if it is still pending
    // when the network goes away it fails and trips the layout error boundary.
    await clickNav(page, '/dashboard');
    await page.waitForLoadState('networkidle');
    await page.waitForTimeout(3_000);

    const attempts: string[] = [];
    const onRequest = (r: Request) => {
      const u = new URL(r.url());
      if (u.pathname === '/assessments.data') attempts.push(u.pathname + u.search);
    };
    page.on('request', onRequest);

    await context.setOffline(true);
    try {
      await clickNav(page, '/assessments');
      // Stale data must still render instantly with no network at all.
      await expect(page.locator('.sb a[href="/assessments"].is-active')).toHaveCount(1);
      // Give a retry loop ample room to reveal itself.
      await page.waitForTimeout(6_000);
    } finally {
      await context.setOffline(false);
      page.off('request', onRequest);
    }

    const refreshes = scopedTo(attempts, 'assessments');
    expect(
      refreshes.length,
      `expected exactly 1 background refresh attempt, saw ${refreshes.length} of ${attempts.length} total: ${attempts.join(', ')}`,
    ).toBe(1);
  });

  // Scoped invalidation is the core of this change: before it, every
  // clientAction ran invalidate('route:') and wiped the entire cache, so ANY
  // mutation made every later navigation a cold blocking fetch.
  test('a mutation stales only the routes that depend on it', async ({ page }) => {
    await clickNav(page, '/assessments');
    await page.waitForLoadState('networkidle');
    await clickNav(page, '/people');
    await page.waitForLoadState('networkidle');

    await clickNav(page, '/config');
    await rewriteUiPrefs(page);
    await page.waitForLoadState('networkidle');

    // A /config mutation stales assessments + tests (shared assessment types).
    // 1 refresh is the norm; the mutation's own live-hub broadcast can echo a
    // second legitimate one into the window, so tolerate 1-2 — the "no
    // retry-storm" property has its own dedicated test above.
    const staled = await recordDataRequests(page, () => clickNav(page, '/assessments'), 2500);
    const refreshes = scopedTo(staled, 'assessments').length;
    expect(
      refreshes >= 1 && refreshes <= 2,
      `expected 1-2 background refreshes of /assessments, saw ${refreshes}: ${staled.join(', ') || '(none)'}`,
    ).toBe(true);

    // ...and nothing else. /people has no dependency on ui-prefs, so it must
    // still be served from cache.
    const untouched = await recordDataRequests(page, () => clickNav(page, '/people'), 2500);
    expect(
      scopedTo(untouched, 'people'),
      `expected /people to stay cached, saw: ${untouched.join(', ')}`,
    ).toEqual([]);
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
