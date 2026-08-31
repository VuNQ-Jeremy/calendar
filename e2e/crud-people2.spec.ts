import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The rest of /people: teachers, parents, and invite codes. Same lifecycle
 * shape as the student spec; each entity type has its own tab, dialog, and
 * confirm strings ("Remove teacher?" / "Remove parent?"). Invites have no
 * confirm at all.
 *
 * Adding anyone mints their login code, so every create here ends on the
 * "Invite codes ready" step and has to dismiss it before the list is back.
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
    // A throwaway number, deliberately NOT the seeded '0900000001' — that phone is an
    // exclusive two-account fixture for crud-login-otp.spec.ts's OTP picker (Leo Park +
    // Mina Park), and if deleting a teacher ever leaves their invite-minted account behind
    // (accounts can outlive the staff/person row that created them — see the note on
    // e2e-created accounts having 'no UI delete path' in scripts/test-accounts.sql), reusing
    // that number here silently inflates that picker's candidate count on every run.
    await k.textIn('Phone').fill('0900000099');
    await k.pickSel('Role', 'Assistant');
    let post = k.posted('/people');
    await k.submit().click(); // "Save"
    await post;
    await k.dlgOf('Invite codes ready').getByRole('button', { name: 'Done' }).click();
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
    await k.dlgOf('Invite codes ready').getByRole('button', { name: 'Done' }).click();
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

  // Siblings share a parent. Ticking "Link an existing parent" has to reuse her row rather
  // than make a second one — and must not mint her a second code, since the one she got
  // when she was added is still unredeemed.
  test('student: link an existing parent instead of adding a second record', async ({ page }) => {
    const k = ui(page);
    const stamp = Date.now();
    const parentName = `E2E shared parent ${stamp}`;
    const siblingName = `E2E sibling ${stamp}`;
    const row = (n: string) => page.locator('.lrow', { hasText: n });

    // The parent, added on their own tab — this is what mints her code.
    await page.getByRole('tab', { name: /^Parents · / }).click();
    await page.getByRole('button', { name: 'Add parent' }).click();
    await k.textIn('Full name').fill(parentName);
    let post = k.posted('/people');
    await k.submit().click();
    await post;
    await k.dlgOf('Invite codes ready').getByRole('button', { name: 'Done' }).click();

    // The second child, linked to her.
    await page.getByRole('tab', { name: /^Students · / }).click();
    await page.getByRole('button', { name: 'Add student' }).click();
    await k.textIn('Full name').fill(siblingName);
    // The real input is opacity:0 — click the label, as the other checkbox specs do.
    await k.dlg.locator('label.mochi-check', { hasText: 'Link an existing parent' }).click();
    // The parent picker is the only select in this branch of the modal; its menu is
    // portalled to document.body, so the option is located from the page.
    await k.dlg.locator('button.m-select__trigger').click();
    await page.getByRole('option', { name: parentName, exact: true }).click();
    post = k.posted('/people');
    await k.submit().click();
    await post;

    // One code, not two: she already has an unredeemed one waiting.
    const codesDlg = k.dlgOf('Invite codes ready');
    await expect(codesDlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/)).toHaveCount(1);
    await expect(codesDlg.getByText('Student code')).toBeVisible();
    await expect(codesDlg.getByText('Parent code')).toHaveCount(0);
    await codesDlg.getByRole('button', { name: 'Done' }).click();

    // The child shows her as guardian, and there is still exactly one of her.
    await expect(row(siblingName)).toContainText(parentName);
    await page.getByRole('tab', { name: /^Parents · / }).click();
    await expect(row(parentName)).toHaveCount(1);

    await page.getByRole('tab', { name: /^Students · / }).click();
    await row(siblingName).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await post;

    await page.getByRole('tab', { name: /^Parents · / }).click();
    await row(parentName).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove parent?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(parentName)).toHaveCount(0);
  });

  // There is no "generate invite" button any more — a code exists because a person does.
  // So this covers the other half: the code that adding someone minted is listed against
  // their name, and can be revoked without touching them.
  test('invite code: minted with a teacher, listed by name, revoked', async ({ page }) => {
    const k = ui(page);
    const name = `E2E invitee ${Date.now()}`;

    await page.getByRole('tab', { name: /^Teachers · / }).click();
    await page.getByRole('button', { name: 'Add teacher' }).click();
    await k.textIn('Full name').fill(name);
    const post = k.posted('/people');
    await k.submit().click(); // "Save"
    await post;
    // The code renders as a plain styled div (mono font via inline style only).
    const dlg = k.dlgOf('Invite codes ready');
    const code = (await dlg.getByText(/^[A-Z0-9]{3}-[A-Z0-9]{3}$/).innerText()).trim();
    expect(code).toHaveLength(7);
    await dlg.getByRole('button', { name: 'Done' }).click();

    await page.getByRole('tab', { name: /^Invites · / }).click();
    const row = page.locator('.lrow', { hasText: code });
    await expect(row).toBeVisible();
    // Linked codes show who they belong to, not a free-text label.
    await expect(row).toContainText(name);

    let del = k.posted('/people');
    await row.getByRole('button', { name: 'Delete' }).click(); // no confirm
    await del;
    await expect(row).toHaveCount(0);

    // Revoking the code leaves the teacher; clean them up too.
    await page.getByRole('tab', { name: /^Teachers · / }).click();
    const staffRow = page.locator('.lrow', { hasText: name });
    await staffRow.getByRole('button', { name: 'Delete' }).click();
    del = k.posted('/people');
    await k.dlgOf('Remove teacher?').locator('.mochi-btn.is-danger').click();
    await del;
    await expect(staffRow).toHaveCount(0);
  });
});
