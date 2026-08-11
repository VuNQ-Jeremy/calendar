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
    // The staff seed account's display name — see seed.sql.
    const authRows = page.locator('details', { hasText: 'Signed in' });
    await expect(authRows.first()).toBeVisible();
    await expect(authRows.first().getByText('Dev')).toBeVisible();
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
      .filter({ hasText: 'Updated' });
    await expect(updateRow.first()).toBeVisible();
    await updateRow.first().locator('summary').click();
    // The diff shows the old name struck through and the new one in place.
    await expect(updateRow.first().getByText(name, { exact: false })).toBeVisible();
    await expect(updateRow.first().getByText(`${name} v2`, { exact: false })).toBeVisible();

    const deleteRow = page
      .locator('details', { hasText: `${name} v2` })
      .filter({ hasText: 'Deleted' });
    await expect(deleteRow.first()).toBeVisible();
    await deleteRow.first().locator('summary').click();
    // A delete's before_json is the full record — the name survives the row being gone.
    await expect(deleteRow.first().getByText(`${name} v2`, { exact: false })).toBeVisible();

    // ---- Entity view: deep-link from the delete row, see all three events for this one id. ----
    await deleteRow.first().getByRole('button').first().click();
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
    const res = await page.goto('/logs/activity');
    expect(res?.status()).toBe(403);
  });
});
