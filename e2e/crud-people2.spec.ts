import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The rest of /people: teachers, parents, and invite codes. Same lifecycle
 * shape as the student spec; each entity type has its own tab, dialog, and
 * confirm strings ("Remove teacher?" / "Remove parent?"). Invites have no
 * confirm at all.
 */

test.describe('CRUD: people (teachers, parents, invites)', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/people');
  });

  test('teacher: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E teacher ${Date.now()}`;
    const row = (n: string) => page.locator('.lrow', { hasText: n });

    await page.getByRole('tab', { name: /^Teachers · / }).click();
    await page.getByRole('button', { name: 'Add teacher' }).click();
    await k.textIn('Full name').fill(name);
    await k.textIn('Phone').fill('0900000001');
    await k.pickSel('Role', 'Assistant');
    let post = k.posted('/people');
    await k.submit().click(); // "Save"
    await post;
    await expect(row(name)).toBeVisible();
    await expect(row(name).getByText('Assistant')).toBeVisible();

    await row(name).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Full name').fill(`${name} v2`);
    post = k.posted('/people');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove teacher?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  test('parent: create linked to a student, edit relation, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E parent ${Date.now()}`;
    const row = (n: string) => page.locator('.lrow', { hasText: n });

    await page.getByRole('tab', { name: /^Parents · / }).click();
    await page.getByRole('button', { name: 'Add parent' }).click();
    // Pick the combobox first — later fills can nudge the dialog and close
    // the portalled menu mid-pick.
    await k.pickSel('Relation', 'Guardian');
    await k.textIn('Full name').fill(name);
    // Children TokenSearch — the menu is portalled to document.body.
    await k.dlg.locator('input.tokensearch__input').fill('Leo');
    await page.locator('.tokensearch__menu .tokensearch__opt', { hasText: 'Leo Park' }).click();
    await expect(k.dlg.locator('.tokensearch .mchip', { hasText: 'Leo Park' })).toBeVisible();
    await k.textIn('Full name').click(); // dismiss the menu before Save
    let post = k.posted('/people');
    await k.submit().click();
    await post;
    await expect(row(name)).toBeVisible();
    await expect(row(name).getByText('Guardian')).toBeVisible();

    // Edit the relation. (This regressed once: the filled name input reset
    // its scrollLeft on blur and the scroll dismissed the menu — fixed in
    // src/ui.tsx's close-on-scroll guard, which this now covers.)
    await row(name).getByRole('button', { name: 'Edit' }).click();
    await k.pickSel('Relation', 'Other');
    post = k.posted('/people');
    await k.submit().click();
    await post;
    await expect(row(name).getByText('Other', { exact: true })).toBeVisible();

    await row(name).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove parent?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(name)).toHaveCount(0);
  });

  test('invite code: generate, appears in list, delete', async ({ page }) => {
    const k = ui(page);
    const label = `E2E invitee ${Date.now()}`;

    await page.getByRole('button', { name: 'Generate invite' }).click();
    const dlg = k.dlgOf('Generate invite code');
    await dlg.locator('input.mochi-input').first().fill(label);
    const post = k.posted('/people');
    await dlg.getByRole('button', { name: 'Generate code' }).click();
    await post;
    // The code renders as a plain styled div (mono font via inline style only).
    const code = (await dlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).innerText()).trim();
    expect(code).toHaveLength(7);
    await dlg.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('tab', { name: /^Invites · / }).click();
    const row = page.locator('.lrow', { hasText: code });
    await expect(row).toBeVisible();

    const del = k.posted('/people');
    await row.getByRole('button', { name: 'Delete' }).click(); // no confirm
    await del;
    await expect(row).toHaveCount(0);
  });
});
