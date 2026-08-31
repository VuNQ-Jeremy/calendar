import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * The plant's whole life, across two browser contexts: the seeded student (Leo Park, Biology 9A)
 * plays and harvests in one, the teacher waters and watches in the other.
 *
 * A one-word topic played through Flip cards is the deterministic qualifying round — 1/1 is 100%,
 * so it clears any threshold the settings card happens to be on. Watering is what carries the
 * plant the rest of the way to fruit: it bypasses the daily growth cap, which is exactly the point
 * of it, and it means this spec never has to play five rounds or wait a day.
 *
 * `c1` is the seeded Biology 9A. Leo Park is in it, so `/garden/c1` is his class garden too.
 */

const CLASS_PATH = '/garden/c1';

test.describe('CRUD: the garden plant lifecycle', () => {
  crudGuard();

  test('plant: grow from a round, name it, get watered, harvest a fruit', async ({
    page,
    browser,
  }) => {
    test.setTimeout(180_000);
    const k = ui(page);
    const topic = `E2E plant topic ${Date.now()}`;

    // ---- Staff: a throwaway topic with exactly one word. ----
    await signInStaff(page);
    await page.goto('/vocabulary');
    await page.getByRole('button', { name: 'New topic' }).click();
    await page.getByLabel('Topic name').fill(topic);
    let post = k.posted('/vocabulary');
    await k.submit().click();
    await post;
    // The title, not the card: a bare .click() hits the card's center, where the staff action
    // buttons live — and they stopPropagation() to open dialogs instead of navigating.
    await page.locator('.mochi-card', { hasText: topic }).getByText(topic).click();
    await page.waitForURL(/\/vocabulary\/.+/);
    const topicPath = new URL(page.url()).pathname;

    await page.getByRole('button', { name: 'Add word' }).click();
    await k.textIn('Word').fill('ephemeral');
    await k.textIn('Meaning (Vietnamese)').fill('phù du');
    post = k.posted(topicPath);
    await k.submit().click();
    await post;

    // ---- Student: an empty pot, then one round, then a seed. ----
    const studentCtx = await browser.newContext();
    const sp = await studentCtx.newPage();
    const sk = ui(sp);
    await signInStudent(sp);
    await sp.goto('/vocabulary');
    // `.first()` alone used to be enough, but PvpBattleCard now renders unconditionally
    // ahead of GardenWidget on /vocabulary for every student (src/flashcards/index.tsx) —
    // exclude it explicitly rather than depend on DOM order between two independent widgets.
    const widget = sp.locator('.mochi-card', { hasNotText: 'Join a battle' }).first();
    // Only on the first attempt: this spec plants a seed, so a retry starts from a garden that
    // already has one and the empty-pot copy would (correctly) be gone.
    if (test.info().retry === 0) await expect(widget).toContainText('Nothing planted yet');

    await sp.goto(topicPath);
    await sp.getByRole('button', { name: 'Flip cards' }).click();
    post = sk.posted(topicPath);
    await sp.getByRole('button', { name: 'I know it' }).click();
    await post;
    // The end screen reports what the round did to the plant.
    await expect(sp.locator('[data-garden-note="grew"]')).toBeVisible();
    await expect(sp.getByText('Your plant grew!')).toBeVisible();
    await sp.getByRole('button', { name: 'Exit' }).first().click();

    await sp.goto('/vocabulary');
    await expect(widget).toContainText('Seed');
    await expect(widget).toContainText('1-day streak');
    // The daily cap is 2, and one of them is now spent.
    await expect(widget).toContainText('1 more growth today');

    // ---- Student: name the plant and repaint the pot. ----
    await widget.getByRole('button', { name: 'Name your plant' }).click();
    const rename = sk.dlgOf('Name your plant');
    await rename.locator('input.mochi-input').fill('Bé Xanh');
    await rename.getByRole('button', { name: 'Violet' }).click();

    // The species grid doubles as the collection: what is earned, what is next, and how far.
    // With no fruit banked yet only the starter is pickable, and the rest say what they cost.
    const species = (name: string) => rename.getByRole('button', { name, exact: true });
    await expect(species('Classic')).toHaveAttribute('aria-pressed', 'true');
    await expect(species('Tomato')).toBeDisabled();
    await expect(species('Apricot blossom')).toBeDisabled();
    await expect(rename).toContainText('1 more fruit');

    post = sk.posted('/vocabulary');
    await rename.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;
    await sp.reload();
    await expect(widget).toContainText('Bé Xanh');

    // ---- Staff: the class garden shows him, and watering carries him to fruit. ----
    await page.goto(CLASS_PATH);
    const leo = page.locator('.mochi-card', { hasText: 'Leo Park' }).first();
    await expect(leo).toContainText('Bé Xanh');
    await expect(leo).toContainText('Seed');

    for (let i = 0; i < 4; i++) {
      await leo.getByRole('button', { name: 'Water' }).click();
      const water = k.dlgOf("Water Leo Park's plant");
      await k
        .on(water)
        .textIn('Note (optional)')
        .fill(`e2e boost ${i + 1}`);
      post = k.posted(CLASS_PATH);
      await water.locator('.m-dialog__foot .mochi-btn.is-primary').click();
      await post;
    }
    await expect(leo).toContainText('Fruiting');

    // The audit trail names the teacher who did it.
    await leo.getByRole('button', { name: 'History' }).click();
    const history = k.dlgOf("Leo Park's plant");
    await expect(history).toContainText('e2e boost 4');
    await expect(history.getByText(/Watered by/).first()).toBeVisible();
    // Scoped to the footer: the dialog's own X is also labelled "Close".
    await history.locator('.m-dialog__foot').getByRole('button', { name: 'Close' }).click();

    // ---- Student: harvest. One fruit, however many times the button is hit. ----
    await sp.goto('/vocabulary');
    const harvest = widget.getByRole('button', { name: 'Harvest' });
    await expect(harvest).toBeVisible();
    post = sk.posted('/vocabulary');
    await harvest.click();
    await post;
    await expect(widget).toContainText('Harvested!');
    // Back to a seed, with the fruit banked for good.
    await expect(widget).toContainText('Seed');
    await expect(widget).toContainText('1 in total');
    await expect(widget).toContainText('1 this month');
    await expect(widget.getByRole('button', { name: 'Harvest' })).toHaveCount(0);

    // ---- The unlock lands in the same breath as the harvest that paid for it. ----
    const unlock = sk.dlgOf('New plant unlocked!');
    await expect(unlock).toContainText('Tomato');
    // Dismissing keeps the plant as it was; the species is still there to pick later.
    await unlock.getByRole('button', { name: 'Not now' }).click();
    await expect(sp.getByText('New plant unlocked!')).toHaveCount(0);

    // ---- Student: that fruit unlocked a species, and the harvest re-seeded the pot, so this is
    // exactly the moment the switch is allowed. ----
    await widget.getByRole('button', { name: 'Name your plant' }).click();
    const replant = sk.dlgOf('Name your plant');
    await expect(replant.getByRole('button', { name: 'Tomato', exact: true })).toBeEnabled();
    // Still out of reach, and still saying by how much.
    await expect(replant.getByRole('button', { name: 'Apricot blossom', exact: true })).toBeDisabled();
    await replant.getByRole('button', { name: 'Tomato', exact: true }).click();
    post = sk.posted('/vocabulary');
    await replant.locator('.m-dialog__foot .mochi-btn.is-primary').click();
    await post;

    await sp.reload();
    await widget.getByRole('button', { name: 'Name your plant' }).click();
    const after = sk.dlgOf('Name your plant');
    await expect(after.getByRole('button', { name: 'Tomato', exact: true })).toHaveAttribute(
      'aria-pressed',
      'true',
    );
    await after.getByRole('button', { name: 'Cancel' }).click();

    // ---- Staff sees the same fruit on the class garden. ----
    await page.goto(CLASS_PATH);
    await expect(page.locator('.mochi-card', { hasText: 'Leo Park' }).first()).toContainText(
      '1 this month',
    );

    // ---- Cleanup: the topic goes, and with it the round it recorded. ----
    await studentCtx.close();
    await page.goto('/vocabulary');
    await page
      .locator('.mochi-card', { hasText: topic })
      .getByRole('button', { name: 'Delete' })
      .click();
    post = k.posted('/vocabulary');
    await k.dlgOf('Delete topic').locator('.mochi-btn.is-danger').click();
    await post;
    await expect(page.locator('.mochi-card', { hasText: topic })).toHaveCount(0);
  });

  test('album: save the previous month and browse it', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto(CLASS_PATH);

    const post = k.posted(CLASS_PATH);
    await page.getByRole('button', { name: 'Save this month' }).click();
    await post;

    // The album link row now offers a month; opening it renders the frozen garden.
    const link = page.locator('a[href^="/garden/c1/album/"]').first();
    await expect(link).toBeVisible();
    await link.click();
    await page.waitForURL(/\/garden\/c1\/album\/\d{4}-\d{2}/);
    await expect(page.getByText('Leo Park')).toBeVisible();

    // Saving again must not create a second copy — an album is a keepsake, not a log.
    await page.goto(CLASS_PATH);
    const again = k.posted(CLASS_PATH);
    await page.getByRole('button', { name: 'Save this month' }).click();
    await again;
    await expect(page.locator('a[href^="/garden/c1/album/"]')).toHaveCount(1);
  });
});
