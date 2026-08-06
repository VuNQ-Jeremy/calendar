import { test, expect, type Locator } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Remaining /config intents: remark criteria lifecycle, grade-level
 * deactivate, the tuition billing checkboxes, and ranking weights. Every test
 * restores what it changes — the seeded four criteria drive the assessments
 * monthly-report spec, and billing/weights feed live tuition and rankings.
 */

test.describe('CRUD: config (criteria, billing, weights)', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
    await page.goto('/config');
  });

  test('remark criterion: create, rename, deactivate, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E criterion ${Date.now()}`;
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Monthly remark criteria' }),
    });
    const row = (n: string) => card.locator('.lrow', { hasText: n });

    await card.getByRole('button', { name: 'Add criterion' }).click();
    await k.dlgOf('Add criterion').locator('input.mochi-input').fill(name);
    let post = k.posted('/config');
    await k.submit().click();
    await post;
    await expect(row(name)).toBeVisible();

    await row(name).getByRole('button', { name: 'Rename' }).click();
    await k.dlgOf('Rename').locator('input.mochi-input').fill(`${name} v2`);
    post = k.posted('/config');
    await k.submit().click();
    await post;
    await expect(row(`${name} v2`)).toBeVisible();

    await row(`${name} v2`).getByRole('button', { name: 'Deactivate' }).click();
    post = k.posted('/config');
    await k.dlgOf('Deactivate').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row(`${name} v2`).getByText('Inactive')).toBeVisible();

    // The criteria card reuses the assessment-type confirm strings.
    await row(`${name} v2`).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.dlgOf('Delete type?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(`${name} v2`)).toHaveCount(0);
  });

  test('grade level: deactivate and reactivate', async ({ page }) => {
    const k = ui(page);
    const name = `E2E toggle level ${Date.now()}`;
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Grade levels' }),
    });
    const row = (n: string) => card.locator('.lrow', { hasText: n });

    await card.getByRole('button', { name: 'Add grade level' }).click();
    await k.dlgOf('Add grade level').locator('input.mochi-input').fill(name);
    let post = k.posted('/config');
    await k.submit().click();
    await post;

    await row(name).getByRole('button', { name: 'Deactivate' }).click();
    post = k.posted('/config');
    await k.dlgOf('Deactivate').getByRole('button', { name: 'Confirm' }).click();
    await post;
    await expect(row(name).getByText('Inactive')).toBeVisible();

    // Activate posts straight away, no confirm.
    post = k.posted('/config');
    await row(name).getByRole('button', { name: 'Activate' }).click();
    await post;
    await expect(row(name).getByText('Active', { exact: true })).toBeVisible();

    await row(name).getByRole('button', { name: 'Delete' }).click();
    post = k.posted('/config');
    await k.dlgOf('Delete grade level?').getByRole('button', { name: 'Delete' }).click();
    await post;
    await expect(row(name)).toHaveCount(0);
  });

  test('tuition billing: toggle Excused on and back off', async ({ page }) => {
    const k = ui(page);
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Tuition billing' }),
    });
    const excused = card.locator('label.mochi-check', { hasText: 'Excused' });
    const box = excused.locator('input[type="checkbox"]');
    await expect(box).not.toBeChecked(); // seed default: Present, Late, Absent

    // Each click saves immediately (optimistic) — gate on the POST.
    let post = k.posted('/config');
    await excused.click();
    await post;
    await expect(box).toBeChecked();

    post = k.posted('/config');
    await excused.click();
    await post;
    await expect(box).not.toBeChecked();
  });

  test('ranking weights: change, persist, restore', async ({ page }) => {
    const k = ui(page);
    const card = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Ranking weights' }),
    });
    const attitude = card
      .locator('.mochi-field', { hasText: 'Attitude weight' })
      .locator('input[type="number"]');
    const testScore = card
      .locator('.mochi-field', { hasText: 'Test score weight' })
      .locator('input[type="number"]');
    const original = await attitude.inputValue();
    const changed = original === '60' ? '70' : '60';

    // Typing one weight auto-fills the complement; Save enables at sum 100.
    await attitude.fill(changed);
    await expect(testScore).toHaveValue(String(100 - Number(changed)));
    let post = k.posted('/config');
    await card.getByRole('button', { name: 'Save' }).click();
    await post;

    await page.reload();
    await expect(attitude).toHaveValue(changed);

    // Restore the original weights.
    await attitude.fill(original);
    post = k.posted('/config');
    await card.getByRole('button', { name: 'Save' }).click();
    await post;
    await page.reload();
    await expect(attitude).toHaveValue(original);
  });

  test('reorder assessment types by drag, persist, restore', async ({ page }) => {
    const k = ui(page);
    const sec = page.locator('.mochi-card', {
      has: page.getByRole('heading', { name: 'Assessment types' }),
    });
    const row = (txt: string) => sec.locator('.lrow', { hasText: txt });
    const titles = sec.locator('.lrow .lrow__title');

    // Playwright's dragTo is flaky here (the list reorders mid-drag), so the
    // HTML5 events are dispatched directly with one shared DataTransfer.
    const fire = (l: Locator, type: 'dragstart' | 'dragover' | 'dragend') =>
      l.evaluate((el, t) => {
        const w = window as Window & { __dt?: DataTransfer };
        if (t === 'dragstart') w.__dt = new DataTransfer();
        el.dispatchEvent(new DragEvent(t, { bubbles: true, cancelable: true, dataTransfer: w.__dt }));
      }, type);
    const move = async (from: string, to: string) => {
      await fire(row(from), 'dragstart');
      await expect(row(from)).toHaveClass(/is-dragging/); // React flushed dragId
      await fire(row(to), 'dragover');
      const post = k.posted('/config');
      await fire(row(from), 'dragend');
      await post;
    };

    const before = await titles.allInnerTexts();
    const [a, b] = before;
    await move(b, a); // drop the 2nd row onto the 1st
    await expect(titles).toHaveText([b, a, ...before.slice(2)]);
    await page.reload();
    await expect(titles).toHaveText([b, a, ...before.slice(2)]); // persisted

    await move(a, b); // restore the seeded order
    await expect(titles).toHaveText(before);
  });
});
