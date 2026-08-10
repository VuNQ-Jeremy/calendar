import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Cohort rankings. A class competes only against classes sharing its khối AND its trình độ, so
 * this walks the surfaces that pairing feeds: the scope select on the Students tab and the
 * per-cohort boards on the Classes tab.
 *
 * The spec asserts structure, not scores — a throwaway class has no attendance or marks for the
 * month, so it lands in the "No data this month" section, and which section it lands in is not
 * what is under test here. The ranking maths is covered by test/rankings.test.ts.
 */

const COHORT = 'Khối 6 · Cơ bản'; // Khối 6 from migration 0017, Cơ bản from 0029

test.describe('CRUD: cohort rankings', () => {
  crudGuard();

  test('a cohort class appears in the scope picker and on the class board', async ({ page }) => {
    const k = ui(page);
    const name = `E2E rank class ${Date.now()}`;
    await signInStaff(page);
    await page.goto('/classes');

    // Create the class through the real dialog, enrolling one seeded student.
    await page.getByRole('button', { name: 'New class' }).click();
    await k.dlg.locator('input[placeholder="e.g. Biology 9A"]').fill(name);
    await k.pickSel('Grade', 'Khối 6');
    await k.pickSel('Level', 'Cơ bản');
    await k.dlg.locator('button', { hasText: 'Leo Park' }).click();
    let post = k.posted('/classes');
    await k.submit().click();
    await post;
    const card = (n: string) => page.locator(`.mochi-card:has(h3:text-is("${n}"))`);
    await expect(card(name)).toBeVisible();

    // Students tab: the cohort is offered as a scope, and picking it keeps the enrolled student.
    await page.goto('/rankings');
    await k.on(page).pickSel('Class', COHORT);
    await expect(page.locator('.lrow', { hasText: 'Leo Park' })).toBeVisible();

    // Classes tab: a board headed by the cohort, containing the new class.
    await page.getByRole('tab', { name: 'Classes' }).click();
    const board = page.locator('.mochi-card', {
      has: page.locator(`.mochi-eyebrow:text-is("${COHORT}")`),
    });
    await expect(board).toBeVisible();
    await expect(board.locator('.lrow', { hasText: name })).toBeVisible();

    // Cleanup — the class is throwaway, and a leaked one would grow every later run's board.
    await page.goto('/classes');
    await card(name).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/classes');
    await k.dlgOf('Delete class?').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(card(name)).toHaveCount(0);
  });
});
