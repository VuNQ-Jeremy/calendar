import type { Recorder } from '../recorder';
import type { Walkthrough } from '../types';

/**
 * Guide #1 — "Lịch & tạo buổi học".
 *
 * Opens the calendar, switches views, then creates a weekly class session and
 * shows it landing on every following week. Ends by dragging the session to a new
 * time in week view.
 *
 * Step ids here are the contract with `src/catalog.ts`, which supplies the
 * Vietnamese caption for each one. Steps whose id starts with `_` are recorded but
 * never shown — the composition trims at the last captioned step, which is how
 * cleanup happens on the same session without appearing on camera.
 */
const TITLE = 'Ôn tập Sinh học';

export const calendarBasics: Walkthrough = {
  id: 'calendar-basics',
  /** Cleanup deletes every event with this title once the browser is closed. */
  marker: TITLE,

  async run(rec: Recorder) {
    const page = rec.page;
    const sidebarCalendar = page.locator('.sb a.sb__item[href="/calendar"]');
    const viewTabs = page.locator('.cal-toolbar .mochi-tabs__tab');
    const modal = page.locator('.m-dialog[role="dialog"]');
    const triggers = modal.locator('.m-select__trigger');

    await rec.step('open-calendar', async () => {
      await rec.focus(page.locator('.sb'));
      await rec.click(sidebarCalendar);
      await page.locator('.cal-toolbar').waitFor({ state: 'visible' });
      await page.waitForLoadState('networkidle');
      await rec.beat(1200);
    });

    await rec.step('switch-views', async () => {
      await rec.focus(page.locator('.cal-toolbar'));
      // Tabs are fixed order: day, week, month, agenda (src/calendar/index.tsx:172).
      await rec.click(viewTabs.nth(2));
      await rec.beat(1400);
    });

    await rec.step('month-overview', async () => {
      // Deliberately wide: the point of this beat is the colour coding across the
      // whole month, not any one control.
      await rec.beat(2600);
    });

    await rec.step('new-event', async () => {
      const btn = page.locator('.m-pagehead__actions .mochi-btn.is-primary');
      await rec.focus(btn);
      await rec.click(btn);
      await modal.waitFor({ state: 'visible' });
      await rec.beat(1000);
    });

    await rec.step('type-title', async () => {
      await rec.focus(modal);
      await rec.type(modal.locator('input.mochi-input').first(), TITLE);
      await rec.beat(900);
    });

    await rec.step('pick-time', async () => {
      await rec.focus(modal.locator('.m-grid.cols-3').first());
      await rec.selectOption(triggers.nth(1), /^2:00 pm$/);
      await rec.beat(500);
      await rec.selectOption(triggers.nth(2), /^3:30 pm$/);
      await rec.beat(900);
    });

    await rec.step('pick-class', async () => {
      await rec.focus(modal.locator('.m-grid.cols-2').first());
      await rec.selectOption(triggers.nth(3), 'Biology 9A');
      // The class's colour is applied to the event on pick
      // (src/calendar/event-modal.tsx:447-451) — hold so the swatch change reads.
      await rec.beat(1400);
    });

    await rec.step('repeat-weekly', async () => {
      await rec.focus(modal.locator('.m-grid.cols-2').first());
      await rec.selectOption(triggers.nth(4), 'Hằng tuần');
      await rec.beat(1200);
    });

    await rec.step('save', async () => {
      const save = modal.locator('.m-dialog__foot .mochi-btn.is-primary');
      await rec.focus(modal.locator('.m-dialog__foot'));
      // Longer than the usual pre-click hold: this caption has to be readable while
      // the dialog is still open, and the click closes it.
      await rec.beat(900);
      await rec.click(save);
      await modal.waitFor({ state: 'hidden' });
      await page.waitForLoadState('networkidle');
      await rec.beat(1200);
    });

    const newPill = page.locator('.month .mpill').filter({ hasText: TITLE }).first();

    await rec.step('see-result', async () => {
      await newPill.waitFor({ state: 'visible' });
      await rec.focus(page.locator('.month .month__cell.is-today'));
      await rec.beat(2400);
    });

    await rec.step('see-recurrence', async () => {
      // Wide again, so all of the month's occurrences are in frame at once.
      await rec.beat(2800);
    });

    await rec.step('drag-to-move', async () => {
      await rec.click(viewTabs.nth(1));
      await page.locator('.tgrid').waitFor({ state: 'visible' });
      await rec.beat(1200);
      await rec.focus(page.locator('.tgrid'));
      const chip = page.locator('.tgrid__col .tev').filter({ hasText: TITLE }).first();
      await chip.waitFor({ state: 'visible' });
      await rec.beat(600);
      // HR_H is 56px per hour (src/calendar/utils.ts:31) — two hours later.
      await rec.drag(chip, 112);
      await page.waitForLoadState('networkidle');
      await rec.beat(2400);
    });

    await rec.step('_settle', async () => {
      // Tail padding so the last caption is not cut off by the outro.
      await rec.beat(1200);
    });
  },
};
