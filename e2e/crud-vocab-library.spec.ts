import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

/**
 * The platform library tier of /vocabulary: a deck with `tenant_id NULL`, readable by every
 * school and writable only by a platform admin.
 *
 * This is a regression spec before it is a feature spec. `listTopics` reads through `db.pool`
 * (own + library) while `updateTopic`/`removeTopic` wrote through `db.own` — so a library deck
 * was listed to the platform admin who owns it, its edit dialog opened and saved, the route
 * answered `{ ok: true }`, and NOT ONE ROW CHANGED. Recolouring one from the topics grid did
 * nothing at all, with no error anywhere to say so. The same bug was fixed for library *words*
 * in commit 0ebecbc; this is the topic-level half.
 *
 * `dev@mochi.edu` — the account `signInStaff` uses — carries `is_platform_admin` in the reset
 * (scripts/test-accounts.sql), which is what makes it the right caller for this. The deck is
 * seeded there too, so it survives the wipe every other spec's cleanup depends on.
 *
 * Colour is the assertion rather than the name because it is what was reported broken, and
 * because it round-trips through the one field with no other side effects: renaming a topic also
 * re-slugs it, which would put a second thing under test in the same assertion.
 */

const LIBRARY_DECK = 'Library Starter Deck';

test.describe('CRUD: the platform vocabulary library', () => {
  crudGuard();

  test('library deck: a platform admin can recolour one, and it sticks', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/vocabulary');

    const card = page.locator('.mochi-card.is-interactive', { hasText: LIBRARY_DECK });
    await expect(card).toBeVisible();

    // The active swatch carries the palette entry's label as its `title` (src/ui.tsx ColorPicker),
    // which is the only place the saved colour is readable as text rather than as a CSS variable.
    const activeSwatch = () => k.dlgOf('Edit topic').locator('.m-swatch.is-active');

    // ---- Seeded violet -> rose. ----
    await card.getByRole('button', { name: 'Edit' }).click();
    let dlg = k.dlgOf('Edit topic');
    await expect(activeSwatch()).toHaveAttribute('title', 'Violet');
    await dlg.locator('.m-swatch[title="Rose"]').click();
    let post = k.posted('/vocabulary');
    await dlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;

    // A full reload, not just a re-render: the dialog closes optimistically and the client cache
    // is invalidated on the way out, so only a fresh load proves the WRITE landed rather than the
    // optimistic state lingering. This is the assertion the bug would have failed.
    await page.reload();
    await expect(card).toBeVisible();
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(activeSwatch()).toHaveAttribute('title', 'Rose');

    // ---- Put it back, so a rerun starts from the seeded colour. ----
    dlg = k.dlgOf('Edit topic');
    await dlg.locator('.m-swatch[title="Violet"]').click();
    post = k.posted('/vocabulary');
    await dlg.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await page.reload();
    await card.getByRole('button', { name: 'Edit' }).click();
    await expect(activeSwatch()).toHaveAttribute('title', 'Violet');
    await k.dlgOf('Edit topic').getByRole('button', { name: 'Cancel' }).click();
  });
});
