import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * Garden: the school-wide tuning settings, on /config behind the Garden row.
 *
 * These four numbers re-time every plant in the school, so the test puts them back when it is
 * done — a leaked `wiltAfterDays: 1` would make the plant specs wilt mid-run.
 */

const DEFAULTS = {
  'Minimum score for free study (%)': '70',
  'Days of silence before wilting': '3',
  'Further days per stage lost': '7',
  'Most stages a student can gain in a day': '2',
};

test.describe('CRUD: garden settings', () => {
  crudGuard();

  test('garden settings: edit, persist, restore', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/config');

    // The controls live in the modal the Garden row opens; a reload closes it, so the
    // persistence checks below reopen it first.
    let card = await openConfigEntry(page, 'Garden');
    const textIn = (label: string) => k.on(card).textIn(label);
    const save = () => card.getByRole('button', { name: 'Save' });

    // Save is disabled until something actually changes.
    await expect(save()).toBeDisabled();

    await textIn('Minimum score for free study (%)').fill('60');
    await textIn('Days of silence before wilting').fill('4');
    await textIn('Further days per stage lost').fill('9');
    await textIn('Most stages a student can gain in a day').fill('3');

    let post = k.posted('/config');
    await save().click();
    await post;

    await page.reload();
    card = await openConfigEntry(page, 'Garden');
    await expect(textIn('Minimum score for free study (%)')).toHaveValue('60');
    await expect(textIn('Days of silence before wilting')).toHaveValue('4');
    await expect(textIn('Further days per stage lost')).toHaveValue('9');
    await expect(textIn('Most stages a student can gain in a day')).toHaveValue('3');

    // Out-of-range input must not be saveable: 0 stages a day would freeze every plant.
    await textIn('Most stages a student can gain in a day').fill('0');
    await expect(save()).toBeDisabled();

    for (const [label, value] of Object.entries(DEFAULTS)) {
      await textIn(label).fill(value);
    }
    post = k.posted('/config');
    await save().click();
    await post;

    await page.reload();
    card = await openConfigEntry(page, 'Garden');
    for (const [label, value] of Object.entries(DEFAULTS)) {
      await expect(textIn(label)).toHaveValue(value);
    }
  });

  /**
   * The admin test tool, and — because the tool backdates the plant's last care rather than faking
   * a look — the only end-to-end coverage of wilting and death. Reaching those states for real
   * takes three days and a month respectively.
   */
  test('dev tools: set a stage, wilt it, kill it, empty the pot', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/garden/c1');
    const leo = page.locator('.mochi-card', { hasText: 'Leo Park' }).first();

    const dial = async (stage: string, idleDays: string) => {
      await leo.getByRole('button', { name: 'Test tools' }).click();
      const dlg = k.dlgOf("Test tools · Leo Park's plant");
      await k.on(dlg).pickSel('Stage', stage);
      await k.on(dlg).textIn('Days since last studied').fill(idleDays);
      const post = k.posted('/garden/c1');
      await dlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
      await post;
    };

    // A healthy plant at fruit.
    await dial('5 · Fruiting', '0');
    await expect(leo).toContainText('Fruiting');

    // Four idle days: wilted, but nothing lost yet (N=3, M=7).
    await dial('4 · In flower', '4');
    await expect(leo).toContainText('In flower');
    await expect(leo.locator('.garden-wilted')).toBeVisible();

    // Eleven idle days: past the first drop, so it is a stage lower than it was dialled to.
    await dial('4 · In flower', '11');
    await expect(leo).toContainText('Young plant');

    // Long enough abandoned that the drops run out — the plant is dead.
    await dial('2 · Sprout', '40');
    await expect(leo).toContainText('Withered');

    // Emptying the pot takes the history with it, leaving an unplanted student.
    await leo.getByRole('button', { name: 'Test tools' }).click();
    const dlg = k.dlgOf("Test tools · Leo Park's plant");
    const post = k.posted('/garden/c1');
    await dlg.locator('.m-dialog__foot').getByRole('button', { name: 'Empty the pot' }).click();
    await post;
    await expect(leo).toContainText('Not planted');
    await leo.getByRole('button', { name: 'History' }).click();
    await expect(k.dlgOf("Leo Park's plant")).toContainText('Nothing has happened');
  });
});
