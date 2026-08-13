import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * The túi mù class board and its visibility toggle. Earning an actual bag requires a full
 * kiosk round-trip (covered by crud-kiosk.spec.ts); this spec instead exercises the board's
 * own contract — it renders a class's roster, and the four config toggles actually gate
 * their surfaces, starting with the board itself.
 */

test.describe('CRUD: túi mù board', () => {
  crudGuard();

  test('board renders the roster and the class board toggle actually gates it', async ({
    page,
  }) => {
    const k = ui(page);
    await signInStaff(page);

    // Board is on by default (showClassBoard defaults true) — the nav item and the page exist.
    await page.goto('/tui-mu');
    await expect(page.getByRole('heading', { name: 'Mystery bags (túi mù)' })).toBeVisible();
    await expect(page.locator('.lrow', { hasText: 'Leo Park' })).toBeVisible();

    // Turn the class board off in config.
    const settingsCard = await openConfigEntry(page, 'Mystery bags (túi mù)');
    let post = k.posted('/config');
    await settingsCard.getByText('Class board', { exact: true }).click();
    await settingsCard.getByRole('button', { name: 'Save' }).click();
    await post;
    await page.keyboard.press('Escape');

    // The board now reports itself disabled.
    await page.goto('/tui-mu');
    await expect(page.getByText('The class board is turned off in Configuration')).toBeVisible();

    // The nav item disappears too (staff sidebar).
    await page.goto('/dashboard');
    await expect(page.locator('.sb__item', { hasText: 'Mystery bags' })).toHaveCount(0);

    // Restore the toggle so reruns and other specs see the default state.
    const settingsCard2 = await openConfigEntry(page, 'Mystery bags (túi mù)');
    post = k.posted('/config');
    await settingsCard2.getByText('Class board', { exact: true }).click();
    await settingsCard2.getByRole('button', { name: 'Save' }).click();
    await post;
  });
});
