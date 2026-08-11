import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * The activity log itself: does every mutation actually land, with the right actor and a
 * readable diff, and is the admin-only gate real. Not a UI-feature spec for /people (that is
 * crud-core.spec.ts) — this reuses its student lifecycle purely as a source of real
 * create/update/delete rows to verify against.
 */

test.describe('CRUD: activity log', () => {
  crudGuard();

  test('security view shows this session own sign-in', async ({ page }) => {
    await signInStaff(page);
    await page.goto('/logs/activity?view=security');
    await expect(page.getByText('Recent sign-ins')).toBeVisible();
    // login rows are attributed to actor_kind 'anon' by design (server/services/audit.ts's
    // attributeAccount) — the SessionUser is not resolved until the NEXT request. The email
    // lives in meta_json, so it only shows once the row is expanded.
    const loginRow = page.locator('details', { hasText: 'Signed in' }).first();
    await expect(loginRow).toBeVisible();
    await loginRow.locator('summary').click();
    await expect(loginRow).toContainText('dev@mochi.edu');
  });

  test('a student create/edit/delete produces precise rows, readable in the stream and the entity view', async ({
    page,
  }) => {
    await signInStaff(page);
    const k = ui(page);
    const name = `E2E activity ${Date.now()}`;
    await page.goto('/people');

    await page.getByRole('button', { name: 'Add student' }).click();
    await k.textIn('Full name').fill(name);
    let post = k.posted('/people');
    await k.submit().click();
    await post;
    await k.dlgOf('Invite codes ready').getByRole('button', { name: 'Done' }).click();

    const row = (n: string) => page.locator('.lrow', { hasText: n });
    await expect(row(name)).toBeVisible();

    await row(name).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Full name').fill(`${name} v2`);
    post = k.posted('/people');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);

    // ---- Stream: filter to students, find the three rows for this one. ----
    await page.goto('/logs/activity?view=stream&entityType=student');
    const createRow = page.locator('details', { hasText: name }).filter({ hasText: 'Created' });
    await expect(createRow.first()).toBeVisible();

    const updateRow = page
      .locator('details', { hasText: `${name} v2` })
      .filter({ hasText: 'Updated' })
      .first();
    await expect(updateRow).toBeVisible();
    await updateRow.locator('summary').click();
    // The diff shows the old name struck through and the new one in place. toContainText on the
    // row itself (not a getByText sub-locator) — "name" is a substring of "name v2", and a
    // sub-locator search would ambiguously match both the before and after cells.
    await expect(updateRow).toContainText(name);
    await expect(updateRow).toContainText(`${name} v2`);

    const deleteRow = page
      .locator('details', { hasText: `${name} v2` })
      .filter({ hasText: 'Deleted' })
      .first();
    await expect(deleteRow).toBeVisible();
    await deleteRow.locator('summary').click();
    // A delete's before_json is the full record — the name survives the row being gone.
    await expect(deleteRow).toContainText(`${name} v2`);

    // ---- Entity view: deep-link from the delete row, see all three events for this one id. ----
    await deleteRow.getByRole('button').first().click();
    await expect(page).toHaveURL(/view=entity&entityType=student&entityId=/);
    const historyRows = page.locator('details');
    await expect(historyRows).toHaveCount(3);
    await expect(page.getByText('Created')).toBeVisible();
    await expect(page.getByText('Updated')).toBeVisible();
    await expect(page.getByText('Deleted')).toBeVisible();
  });

  test('page views land as beacon rows', async ({ page }) => {
    await signInStaff(page);
    // A couple of navigations to generate beacon traffic. src/lib/track.ts flushes on a 15s
    // timer or a visibilitychange to 'hidden' — Playwright cannot force real tab visibility, so
    // this waits out the timer rather than faking the event.
    await page.goto('/dashboard');
    await page.goto('/classes');
    await page.waitForTimeout(16_000);

    await page.goto('/logs/activity?view=stream&action=view');
    await expect(page.locator('details', { hasText: 'Viewed' }).first()).toBeVisible();
  });

  test('a non-admin is denied', async ({ page }) => {
    await signInStudent(page);
    // requireAdmin = requireStaff (redirects any NON-staff actor away — a 302, before any role
    // check runs) + a 403 role check that only staff ever reach. A student is turned away by the
    // first half, so the literal status a browser sees is the redirect's landing page, not a bare
    // 403 — asserting on the redirect (Playwright follows it) is what actually proves "denied".
    await page.goto('/logs/activity');
    await expect(page).not.toHaveURL(/\/logs\/activity/);
    await expect(page.getByRole('heading', { name: 'Activity log' })).toHaveCount(0);
  });
});
