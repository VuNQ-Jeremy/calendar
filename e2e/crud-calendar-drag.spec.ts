import { test, expect, type Locator, type Page } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * Dragging events between days, and the scope question a recurring event asks first.
 *
 * The grids drive raw mouse events on `window` (no dnd library, no HTML5 DragEvent), so every
 * gesture here is a real mouse.down → move → up. Two contract points the specs guard:
 *
 *  - A drop must never open the editor. The click that follows mouseup used to slip past the
 *    guard and pop the dialog over the result.
 *  - A recurring drop commits nothing until the chooser is answered, so `posted()` is armed
 *    AFTER the choice, not before the drop.
 */

const isoOf = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

/** Wednesday of the current week — startOfWeek is Monday, so it is column index 2, with room either side. */
function wednesday(): Date {
  const d = new Date();
  d.setDate(d.getDate() - ((d.getDay() + 6) % 7) + 2);
  return d;
}

/** Mon = 0 … Sun = 6. */
const col = (page: Page, i: number) => page.locator('.tgrid__col').nth(i);

async function createEvent(page: Page, title: string, dk: string, repeat?: string) {
  const k = ui(page);
  await page.getByRole('button', { name: 'New event' }).click();
  await k.dlg.locator('input[placeholder="e.g. Biology lab"]').fill(title);
  // Portalled date picker: each day button is labelled with its ISO date.
  await k.field('Date').locator('button.m-select__trigger').click();
  // A date a week back can fall outside the month the picker opens on.
  const day = page.locator(`.m-datepicker__day[aria-label="${dk}"]`);
  if ((await day.count()) === 0) await page.getByRole('button', { name: 'Previous month' }).click();
  await day.first().click();
  if (repeat) await k.pickSel('Repeat', repeat);
  const post = k.posted('/calendar');
  await k.submit().click();
  await post;
}

/**
 * Press, travel, and stop — without releasing, so a spec can assert on the drop target first.
 * Stepped rather than jumped: the first move has to clear the 4px threshold and each one has to
 * let React commit the preview state.
 */
async function dragTo(page: Page, from: Locator, to: { x: number; y: number }) {
  const box = (await from.boundingBox())!;
  const start = { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  await page.mouse.move(start.x, start.y);
  await page.mouse.down();
  for (let i = 1; i <= 4; i++) {
    await page.mouse.move(
      start.x + ((to.x - start.x) * i) / 4,
      start.y + ((to.y - start.y) * i) / 4,
    );
    await page.waitForTimeout(30);
  }
}

/** Centre of a locator, the natural drop point. */
async function centre(l: Locator) {
  const b = (await l.boundingBox())!;
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

/** Minutes past midnight from the start half of a "9:30am – 10:30am" label (fmtTime drops ":00"). */
function startMinutes(label: string): number {
  const m = /^(\d{1,2})(?::(\d{2}))?(am|pm)/.exec(label.trim());
  if (!m) throw new Error(`unparseable time label: ${label}`);
  const h = (Number(m[1]) % 12) + (m[3] === 'pm' ? 12 : 0);
  return h * 60 + Number(m[2] ?? 0);
}

/**
 * Delete an event outright, answering the scope chooser with "All events" when it appears —
 * a detached occurrence is its own non-recurring row and is never asked.
 */
async function deleteWholeSeries(page: Page, title: string) {
  const k = ui(page);
  await page.getByRole('tab', { name: 'Agenda' }).click();
  const row = page.locator('.aev', { hasText: title }).first();
  if ((await row.count()) === 0) return;
  await row.click();
  // Armed before the click: a non-recurring row posts on it, a recurring one not until the
  // chooser is answered, and waitForResponse simply stays pending in between.
  const post = k.posted('/calendar');
  const chooser = k.dlgOf('Delete recurring event');
  await k.dlg.first().locator('.m-dialog__foot .mochi-btn.is-danger').click();
  if (await chooser.isVisible().catch(() => false)) {
    await chooser.getByRole('radio', { name: 'All events' }).check();
    await chooser.locator('.m-dialog__foot .mochi-btn.is-danger').click();
  }
  await post;
}

test.describe('CRUD: calendar drag and drop', () => {
  crudGuard();

  test.beforeEach(async ({ page }) => {
    await signInStaff(page);
  });

  test('week view: a one-off event drags to another day without opening the editor', async ({
    page,
  }) => {
    const k = ui(page);
    const title = `E2E drag ${Date.now()}`;
    const wed = wednesday();
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(wed));

    await page.getByRole('tab', { name: 'Week' }).click();
    const block = page.locator('.tev', { hasText: title });
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    // One column right, and half an hour down.
    const width = (await col(page, 2).boundingBox())!.width;
    const from = await centre(block);
    await dragTo(page, block, { x: from.x + width, y: from.y + 28 });
    const post = k.posted('/calendar');
    await page.mouse.up();
    await post;

    await expect(k.dlg).toHaveCount(0); // the drop must not pop the editor
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();
    await expect(col(page, 2).locator('.tev', { hasText: title })).toHaveCount(0);

    await deleteWholeSeries(page, title);
  });

  test('week view: a dragged block snaps to the half hour, not the minute', async ({ page }) => {
    const k = ui(page);
    const title = `E2E snap ${Date.now()}`;
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(wednesday()));

    await page.getByRole('tab', { name: 'Week' }).click();
    const block = page.locator('.tev', { hasText: title });
    await expect(block).toBeVisible();
    const before = startMinutes(await block.locator('.tev__time').innerText());

    // Travel 0.6 of an hour — 36 minutes, deliberately not a multiple of the snap, and far enough
    // from both 30 and 60 that pixel rounding cannot decide the outcome.
    const hourPx = await page
      .locator('.tgrid')
      .first()
      .evaluate((el) => parseFloat(getComputedStyle(el).getPropertyValue('--hr-h')));
    const from = await centre(block);
    await dragTo(page, block, { x: from.x, y: from.y + hourPx * 0.6 });
    const post = k.posted('/calendar');
    await page.mouse.up();
    await post;

    // 36 minutes of travel must commit as exactly 30. It used to commit as 36.
    expect(startMinutes(await block.locator('.tev__time').innerText()) - before).toBe(30);

    await deleteWholeSeries(page, title);
  });

  test('month view: dragging a chip changes the date and keeps the time', async ({ page }) => {
    const k = ui(page);
    const title = `E2E monthdrag ${Date.now()}`;
    const wed = wednesday();
    const thu = new Date(wed);
    thu.setDate(thu.getDate() + 1);
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(wed));

    await page.getByRole('tab', { name: 'Month' }).click();
    const pill = page.locator(`.month__cell[data-dk="${isoOf(wed)}"] .mpill`, { hasText: title });
    await expect(pill).toBeVisible();
    const timeBefore = await pill.locator('.mpill__time').innerText();
    const target = page.locator(`.month__cell[data-dk="${isoOf(thu)}"]`);

    await dragTo(page, pill, await centre(target));
    await expect(target).toHaveClass(/is-droptarget/); // the cell knows it is the drop target
    const post = k.posted('/calendar');
    await page.mouse.up();
    await post;

    await expect(k.dlg).toHaveCount(0);
    const moved = target.locator('.mpill', { hasText: title });
    await expect(moved).toBeVisible();
    await expect(
      page.locator(`.month__cell[data-dk="${isoOf(wed)}"] .mpill`, { hasText: title }),
    ).toHaveCount(0);
    // A month cell has no time axis, so the move must have left the times untouched.
    await expect(moved.locator('.mpill__time')).toHaveText(timeBefore);

    await deleteWholeSeries(page, title);
  });

  test('week view: dragging a recurring event asks which occurrences it applies to', async ({
    page,
  }) => {
    const k = ui(page);
    const title = `E2E recur ${Date.now()}`;
    const wed = wednesday();
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(wed), 'Every week');

    await page.getByRole('tab', { name: 'Week' }).click();
    const block = () => page.locator('.tev', { hasText: title });
    const width = (await col(page, 2).boundingBox())!.width;

    // --- Cancelling the chooser leaves the series alone ---
    let from = await centre(block());
    await dragTo(page, block(), { x: from.x + width, y: from.y });
    await page.mouse.up();
    const chooser = k.dlgOf('Edit recurring event');
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('radio', { name: 'This event' })).toBeChecked();
    await expect(chooser.getByRole('radio', { name: 'This and following events' })).toBeVisible();
    await expect(chooser.getByRole('radio', { name: 'All events' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    // --- "This event" moves one occurrence and leaves the rest of the series where it was ---
    from = await centre(block());
    await dragTo(page, block(), { x: from.x + width, y: from.y });
    await page.mouse.up();
    await expect(chooser).toBeVisible();
    let post = k.posted('/calendar');
    await chooser.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();

    await page.getByRole('button', { name: 'Next' }).click();
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    // --- "This and following" splits the series: next week onward moves, this week does not ---
    from = await centre(block());
    await dragTo(page, block(), { x: from.x + width, y: from.y });
    await page.mouse.up();
    await expect(chooser).toBeVisible();
    await chooser.getByRole('radio', { name: 'This and following events' }).check();
    post = k.posted('/calendar');
    await chooser.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();

    // The week after inherits the split's new day…
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();
    // …and the original week, two back, still holds the detached "this event" occurrence.
    await page.getByRole('button', { name: 'Previous' }).click();
    await page.getByRole('button', { name: 'Previous' }).click();
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();

    await deleteWholeSeries(page, title);
    // The split's tail and the detached occurrence are separate rows — clear whatever is left.
    await deleteWholeSeries(page, title);
    await deleteWholeSeries(page, title);
    await expect(page.locator('.aev', { hasText: title })).toHaveCount(0);
  });

  test('week view: dragging a past occurrence detaches it without asking', async ({ page }) => {
    const k = ui(page);
    const title = `E2E past ${Date.now()}`;
    const lastWed = wednesday();
    lastWed.setDate(lastWed.getDate() - 7); // whatever today is, Wednesday a week back is behind us
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(lastWed), 'Every week');

    await page.getByRole('tab', { name: 'Week' }).click();
    await page.getByRole('button', { name: 'Previous' }).click();
    const block = page.locator('.tev', { hasText: title });
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    // Armed BEFORE the release, unlike every other recurring drag here: moving an occurrence that
    // already happened commits on the drop, with no question in between.
    const width = (await col(page, 2).boundingBox())!.width;
    const from = await centre(block);
    await dragTo(page, block, { x: from.x + width, y: from.y });
    const post = k.posted('/calendar');
    await page.mouse.up();
    await post;

    await expect(k.dlg).toHaveCount(0); // no chooser, and no editor either
    await expect(col(page, 3).locator('.tev', { hasText: title })).toBeVisible();

    // The pattern itself is untouched — this week still keeps its Wednesday.
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    // And the moved occurrence is a standalone event now, so deleting it asks nothing.
    await page.getByRole('button', { name: 'Previous' }).click();
    await col(page, 3).locator('.tev', { hasText: title }).click();
    const gone = k.posted('/calendar');
    await k.dlg.first().locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await gone;
    await expect(k.dlgOf('Delete recurring event')).toHaveCount(0);
    await expect(col(page, 3).locator('.tev', { hasText: title })).toHaveCount(0);

    await deleteWholeSeries(page, title);
  });

  test('deleting one occurrence of a series leaves the others in place', async ({ page }) => {
    const k = ui(page);
    const title = `E2E recurdel ${Date.now()}`;
    const wed = wednesday();
    await page.goto('/calendar');
    await createEvent(page, title, isoOf(wed), 'Every week');

    await page.getByRole('tab', { name: 'Week' }).click();
    await col(page, 2).locator('.tev', { hasText: title }).click();
    const chooser = k.dlgOf('Delete recurring event');
    await k.dlg.first().locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await expect(chooser).toBeVisible();
    await expect(chooser.getByRole('radio', { name: 'This event' })).toBeChecked();
    const post = k.posted('/calendar');
    await chooser.locator('.m-dialog__foot .mochi-btn.is-danger').click();
    await post;

    await expect(col(page, 2).locator('.tev', { hasText: title })).toHaveCount(0);
    await page.getByRole('button', { name: 'Next' }).click();
    await expect(col(page, 2).locator('.tev', { hasText: title })).toBeVisible();

    await deleteWholeSeries(page, title);
  });

  test('dashboard: editing a recurring event asks the same question', async ({ page }) => {
    const k = ui(page);
    const title = `E2E dashrecur ${Date.now()}`;
    await page.goto('/calendar');
    // Dated today, so the dashboard's "Today's schedule" card lists it.
    await createEvent(page, title, isoOf(new Date()), 'Every week');

    await page.goto('/dashboard');
    const row = page.locator('.mochi-card', { hasText: title }).first();
    await expect(row).toContainText(title);
    await row.locator(`text=${title}`).first().click();

    await k.dlg.first().locator('input[placeholder="e.g. Biology lab"]').fill(`${title} v2`);
    await k.dlg.first().locator('.m-dialog__foot .mochi-btn.is-primary').click();
    const chooser = k.dlgOf('Edit recurring event');
    await expect(chooser).toBeVisible();
    // Cancelling returns to the editor with the edit still in the field.
    await page.keyboard.press('Escape');
    await expect(chooser).toHaveCount(0);
    await expect(k.dlg.first().locator('input[placeholder="e.g. Biology lab"]')).toHaveValue(
      `${title} v2`,
    );
    await page.keyboard.press('Escape');

    await page.goto('/calendar');
    await deleteWholeSeries(page, title);
  });
});
