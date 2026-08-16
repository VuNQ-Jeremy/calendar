import { test, expect } from '@playwright/test';
import { crudGuard, eventTitleInput, signInStaff, ui } from './crud-helpers';

/**
 * The event dialog's secondary writes — attendance, event materials, session
 * preview — plus the calendar theme. The extra tabs only exist on a SAVED
 * event with a class, so the spec creates its own Biology 9A event (today's
 * date keeps it inside the agenda window) and deletes it at the end.
 */

test.describe('CRUD: event tabs and calendar theme', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/calendar');
  });

  test('attendance, event material, session preview on one event', async ({ page }) => {
    const k = ui(page);
    const title = `E2E class session ${Date.now()}`;

    // Create a class-bound event.
    await page.getByRole('button', { name: 'New event' }).click();
    await eventTitleInput(k.dlg).fill(title);
    await k.pickSel('Class', 'Biology 9A');
    let post = k.posted('/calendar');
    await k.submit().click();
    await post;

    // Reopen it from the agenda — now the tab strip renders.
    await page.getByRole('tab', { name: 'Agenda' }).click();
    await page.locator('.aev', { hasText: title }).click();
    await expect(k.dlg.getByRole('tab', { name: 'Attendance' })).toBeVisible();

    // --- Attendance: chip per student, autosaves on every click ---
    await k.dlg.getByRole('tab', { name: 'Attendance' }).click();
    const leo = k.dlg.locator('.lrow', { hasText: 'Leo Park' });
    post = k.posted('/attendance');
    await leo.getByRole('button', { name: 'Late' }).click();
    await post;
    await expect(k.dlg.getByText('Attendance saved')).toBeVisible();
    // Clicking the active chip again unmarks (posts the reduced set).
    post = k.posted('/attendance');
    await leo.getByRole('button', { name: 'Late' }).click();
    await post;
    // Mark the whole roster present in one shot.
    post = k.posted('/attendance');
    await k.dlg.getByRole('button', { name: 'Mark all present' }).click();
    await post;

    // --- Event material: the picker lives on the Details tab ---
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    await k.dlg.locator('input.tokensearch__input').fill('Khan');
    post = k.posted('/event-materials');
    await page
      .locator('.tokensearch__menu .tokensearch__opt', { hasText: 'Khan: Quadratics' })
      .getByRole('button', { name: 'Add' })
      .click();
    await post;
    const attached = k.dlg.locator('.lrow', { hasText: 'Khan: Quadratics' });
    await expect(attached).toBeVisible();
    // Detach again.
    post = k.posted('/event-materials');
    await attached.getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(attached).toHaveCount(0);

    // --- Session preview: explicit Save button inside the tab body ---
    await k.dlg.getByRole('tab', { name: 'Next session' }).click();
    await k.textIn("What we'll study").fill('E2E: unit 5 conditionals');
    post = k.posted('/event-previews');
    await k.dlg.locator('.m-dialog__body').getByRole('button', { name: 'Save' }).click();
    await post;
    await expect(k.dlg.getByText('Saved', { exact: true })).toBeVisible();

    // Cleanup: delete the event from the Details tab (no confirm).
    await k.dlg.getByRole('tab', { name: 'Details' }).click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.aev', { hasText: title })).toHaveCount(0);
  });

  test('calendar theme: preset applies and restores', async ({ page }) => {
    const k = ui(page);

    await page.getByRole('button', { name: 'Customize' }).click();
    const drawer = page.locator('aside.drawer');
    await expect(drawer).toBeVisible();

    // Dusk preset posts immediately and lands as CSS vars on the grid.
    let post = k.posted('/calendar');
    await drawer.locator('button.preset', { hasText: 'Dusk' }).click();
    await post;
    await expect(drawer.locator('button.preset', { hasText: 'Dusk' })).toHaveClass(/is-active/);
    await expect(page.locator('.calwrap')).toHaveAttribute('style', /--cal-bg:\s*#2E2A33/i);

    // Cream IS the default theme — clicking it restores everything.
    post = k.posted('/calendar');
    await drawer.locator('button.preset', { hasText: 'Cream' }).click();
    await post;
    await expect(page.locator('.calwrap')).toHaveAttribute('style', /--cal-bg:\s*#FFFCF8/i);
    await drawer.getByRole('button', { name: 'Done' }).click();
    await expect(drawer).toHaveCount(0);
  });
});
