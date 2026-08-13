import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * UI-driven CRUD for the three core domains: calendar events, classes, and
 * students. Each test walks a full create → edit → delete lifecycle through
 * the real dialogs, asserting on the re-rendered lists after every POST.
 */

test.describe('CRUD: core domains', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('calendar event: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const title = `E2E event ${Date.now()}`;
    await page.goto('/calendar');

    // Create. The date defaults to today, so the event lands in the current
    // agenda window without touching the (custom, portalled) date picker.
    await page.getByRole('button', { name: 'New event' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(title);
    let post = k.posted('/calendar');
    await k.submit().click(); // "Add event"
    await post;

    // Agenda is a flat list with no drag handlers — the safest view to assert
    // on and to click events in.
    await page.getByRole('tab', { name: 'Agenda' }).click();
    const event = page.locator('.aev', { hasText: title });
    await expect(event).toBeVisible();

    // Edit: clicking the event opens the full editor.
    await event.click();
    await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(`${title} v2`);
    post = k.posted('/calendar');
    await k.submit().click(); // "Save"
    await post;
    const renamed = page.locator('.aev', { hasText: `${title} v2` });
    await expect(renamed).toBeVisible();

    // Delete: the footer's danger button — events have NO confirm dialog.
    await renamed.click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.aev', { hasText: title })).toHaveCount(0);
  });

  test("dashboard: an event dated tomorrow shows in 'Coming up'", async ({ page }) => {
    const k = ui(page);
    const title = `E2E upcoming ${Date.now()}`;
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dk = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, '0')}-${String(tomorrow.getDate()).padStart(2, '0')}`;
    await page.goto('/calendar');

    await page.getByRole('button', { name: 'New event' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(title);
    // The date picker is portalled to document.body; each day button is labelled with its ISO
    // date, so tomorrow is addressable even when it falls in the next month's leading cells.
    await k.field('Date').locator('button.m-select__trigger').click();
    await page.locator(`.m-datepicker__day[aria-label="${dk}"]`).first().click();
    let post = k.posted('/calendar');
    await k.submit().click(); // "Add event"
    await post;

    // A full load, not a client nav: the dashboard's own loader is what supplies the window.
    await page.goto('/dashboard');
    const card = page.locator('.mochi-card:has(h2:text-is("Coming up"))');
    await expect(card).toContainText(title);
    await expect(card).toContainText('Tomorrow');

    // Clean up through the agenda, whose 14-day window covers tomorrow.
    await page.goto('/calendar');
    await page.getByRole('tab', { name: 'Agenda' }).click();
    const event = page.locator('.aev', { hasText: title });
    await expect(event).toBeVisible();
    await event.click();
    post = k.posted('/calendar');
    await k.dlg.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.aev', { hasText: title })).toHaveCount(0);
  });

  test('class: create with roster, edit, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E class ${Date.now()}`;
    await page.goto('/classes');

    // Create, enrolling one seeded student through the roster toggles.
    await page.getByRole('button', { name: 'New class' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology 9A"]').fill(name);
    // Subject is a managed list now — 'Science' is seeded on class c1 and re-derived by
    // scripts/test-accounts.sql after every reset.
    await k.pickSel('Subject', 'Science');
    // Khối + trình độ are required — Save stays disabled until both are picked. The options
    // are the rows seeded by migrations 0017/0029 and re-asserted by scripts/test-accounts.sql.
    await expect(k.submit()).toBeDisabled();
    await k.pickSel('Grade', 'Khối 6');
    await k.pickSel('Level', 'Cơ bản');
    await k.dlg.locator('button', { hasText: 'Leo Park' }).click();
    let post = k.posted('/classes');
    await k.submit().click(); // "Save class"
    await post;

    const card = (n: string) => page.locator(`.mochi-card:has(h3:text-is("${n}"))`);
    await expect(card(name)).toBeVisible();
    await expect(card(name)).toContainText('1 student');
    await expect(card(name).locator('.mochi-tag', { hasText: 'Science' })).toBeVisible();
    await expect(card(name).locator('.mochi-tag', { hasText: 'Khối 6' })).toBeVisible();
    await expect(card(name).locator('.mochi-tag', { hasText: 'Cơ bản' })).toBeVisible();

    // Edit via the card's pencil icon (the card body opens a detail dialog). The cohort is not
    // re-picked here: Save staying enabled proves both ids round-tripped into the draft.
    await card(name).getByRole('button', { name: 'Edit' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology 9A"]').fill(`${name} v2`);
    post = k.posted('/classes');
    await k.submit().click();
    await post;
    await expect(card(`${name} v2`)).toBeVisible();

    // Delete — confirms with "Delete class?".
    await card(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/classes');
    await k.dlgOf('Delete class?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(card(`${name} v2`)).toHaveCount(0);
  });

  test('student: create enrolled in a class, edit, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E student ${Date.now()}`;
    await page.goto('/people'); // Students tab is the default

    await page.getByRole('button', { name: 'Add student' }).click();
    await k.textIn('Full name').fill(name);
    // Grade sits with the classes it belongs to and is labelled by its placeholder.
    await k.dlg.getByPlaceholder('Grade').fill('9');
    // TokenSearch: the suggestion menu is portalled to document.body.
    await k.dlg.locator('input.tokensearch__input').fill('Bio');
    await page.locator('.tokensearch__menu .tokensearch__opt', { hasText: 'Biology 9A' }).click();
    await expect(k.dlg.locator('.tokensearch .mchip', { hasText: 'Biology 9A' })).toBeVisible();
    // The suggestion menu only closes on an outside pointerdown and would
    // otherwise sit over the footer, swallowing the Save click.
    await k.dlg.getByPlaceholder('Grade').click();
    let post = k.posted('/people');
    await k.submit().click(); // "Save"
    await post;
    // Creating mints the student's login code; the modal ends on it.
    await k.dlgOf('Invite codes ready').getByRole('button', { name: 'Done' }).click();

    const row = (n: string) => page.locator('.lrow', { hasText: n });
    await expect(row(name)).toBeVisible();
    await expect(row(name).locator('.mochi-tag', { hasText: 'Biology 9A' })).toBeVisible();

    // Edit.
    await row(name).getByRole('button', { name: 'Edit' }).click();
    await k.textIn('Full name').fill(`${name} v2`);
    post = k.posted('/people');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    // Delete — people confirm with "Remove", not "Delete".
    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/people');
    await k.dlgOf('Remove student?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });
});
