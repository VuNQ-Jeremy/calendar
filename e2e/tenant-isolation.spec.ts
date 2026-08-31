import { test, expect } from '@playwright/test';
import type { Page } from '@playwright/test';
import { crudGuard, gotoEmailLogin, signInStaff, ui } from './crud-helpers';

/**
 * The acceptance test for multi-tenancy.
 *
 * Everything else in this feature is a mechanism — a column, a wrapper, a guard. This spec is
 * the claim those mechanisms exist to support: a school cannot see, reach, or guess another
 * school's data, and the only account that can cross the line does so visibly and deliberately.
 *
 * It deliberately drives the real signup form rather than seeding a second school in SQL. A
 * school created the way a customer creates one is the only one worth asserting against.
 */

crudGuard();

const stamp = Date.now();
const CANARY_CLASS = `E2E ISOLATION CANARY ${stamp}`;
const SCHOOL_B = `E2E Academy ${stamp}`;
const EMAIL_B = `e2e-signup-${stamp}@mochi.local`;
const PASSWORD_B = 'mochi123';

/** Create a school through the public form and land signed in as its first Admin. */
async function signUpNewTenant(page: Page) {
  await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
  await page.goto('/signup');
  await page.fill('input[name="schoolName"]', SCHOOL_B);
  await page.fill('input[name="name"]', 'E2E Admin');
  await page.fill('input[name="email"]', EMAIL_B);
  await page.fill('input[name="password"]', PASSWORD_B);
  await page.click('button[type="submit"]');
  await page.waitForURL(/\/dashboard/, { timeout: 30_000 });
}

test.describe('tenant isolation', () => {
  test('a school created at signup is invisible to the original school', async ({ browser }) => {
    // ---- School B: sign up, then create a class with an unmistakable name. ----
    const ctxB = await browser.newContext();
    const pageB = await ctxB.newPage();
    await signUpNewTenant(pageB);

    // A brand-new school starts empty, and the getting-started card says so.
    await expect(pageB.locator('text=Getting started')).toBeVisible();

    const k = ui(pageB);
    await pageB.goto('/classes');
    await pageB.getByRole('button', { name: 'New class' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology 9A"]').fill(CANARY_CLASS);
    // Khối and trình độ are required — Save stays disabled until both are picked. That they are
    // pickable at all in a school created seconds ago is the point of `seedTenantDefaults`:
    // without those two lists a new school could not create its first class, and the
    // getting-started card would lead straight into a dead end. Subject is NOT required, which
    // is why an empty subject list is survivable.
    await expect(k.submit()).toBeDisabled();
    await k.pickSel('Grade', 'Khối 6');
    await k.pickSel('Level', 'Cơ bản');
    const post = k.posted('/classes');
    await k.submit().click();
    await post;
    await expect(pageB.locator(`text=${CANARY_CLASS}`)).toBeVisible();

    // The seeded defaults arrived with the school. `/config` is rows that open into modals, so
    // the type NAMES are not on the page itself — only a "6 of 6 active" summary. Open the row.
    await pageB.goto('/config');
    await pageB.locator('.cfg-row', { hasText: 'Assessment types' }).click();
    await expect(
      pageB
        .locator('.m-dialog:has(.m-dialog__title:text-is("Assessment types"))')
        .locator('text=Kiểm tra miệng'),
    ).toHaveCount(1);

    // ---- School A (the seeded original): the canary must not exist anywhere. ----
    const ctxA = await browser.newContext();
    const pageA = await ctxA.newPage();
    await signInStaff(pageA);

    for (const path of ['/classes', '/people', '/calendar']) {
      await pageA.goto(path);
      await expect(
        pageA.locator(`text=${CANARY_CLASS}`),
        `${CANARY_CLASS} leaked onto ${path}`,
      ).toHaveCount(0);
    }

    // A direct read by id must refuse rather than serve — guessing an id is the attack the
    // list-page assertions above cannot rule out.
    const ids = (await pageB.evaluate(async () => {
      const res = await fetch('/api/classes', { headers: { accept: 'application/json' } });
      return res.ok ? await res.json() : null;
    })) as { data?: { id: string; name: string }[] } | null;
    const canaryId = ids?.data?.find((c) => c.name === CANARY_CLASS)?.id;
    if (canaryId) {
      const status = await pageA.evaluate(async (id) => {
        const res = await fetch(`/api/classes?id=${id}`, { method: 'DELETE' });
        return res.status;
      }, canaryId);
      expect([403, 404]).toContain(status);
      // And it is still there afterwards.
      await pageB.goto('/classes');
      await expect(pageB.locator(`text=${CANARY_CLASS}`)).toBeVisible();
    }

    await ctxA.close();
    await ctxB.close();
  });

  test('a platform admin can enter another school, and it is obvious they have', async ({
    page,
  }) => {
    // dev@mochi.edu carries is_platform_admin in the test reset (scripts/test-accounts.sql).
    await signInStaff(page);
    await page.goto('/platform');
    await expect(page.locator(`text=${SCHOOL_B}`)).toBeVisible();

    const row = page.locator('tr', { hasText: SCHOOL_B });
    await row.getByRole('button', { name: 'Enter' }).click();
    await page.waitForLoadState('networkidle');

    // Inside school B now: its canary is visible where a moment ago it was not.
    await page.goto('/classes');
    await expect(page.locator(`text=${CANARY_CLASS}`)).toBeVisible();

    // Leaving puts the original school back.
    await page.goto('/platform');
    await page.getByRole('button', { name: 'Exit' }).first().click();
    await page.waitForLoadState('networkidle');
    await page.goto('/classes');
    await expect(page.locator(`text=${CANARY_CLASS}`)).toHaveCount(0);
  });

  test('an ordinary school admin cannot reach the platform page', async ({ page }) => {
    // The student account stands in for "anyone who is not a platform admin"; the route must
    // refuse rather than render, whatever their role inside their own school.
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await gotoEmailLogin(page);
    await page.fill('input[name="email"]', 'vunq@mochi.edu');
    await page.fill('input[name="password"]', 'mochi123');
    await page.click('form[action="/login"] button[type="submit"]');
    await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });

    // `page.goto` FOLLOWS redirects, so it reports the 200 of wherever the bounce landed and can
    // never see the refusal. `requirePlatformAdmin` calls `requireAdmin` first, and that redirects
    // a student (302 → /vocabulary) before the 403 is ever reached — so the check has to be made
    // without following. `page.request` carries the browser context's session cookie.
    const res = await page.request.get('/platform', { maxRedirects: 0 });
    expect(res.status()).not.toBe(200);
    // And the bounce must be a real refusal, not a 404 that happens to hide the page.
    expect([302, 303, 403]).toContain(res.status());
  });
});
