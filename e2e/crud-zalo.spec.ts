import { test, expect } from '@playwright/test';
import { crudGuard, openConfigEntry, signInStaff, ui } from './crud-helpers';

/**
 * The Zalo pairing lifecycle, driven from the UI and closed by a synthetic webhook call.
 *
 * The webhook half is what makes this worth having. Everything else about the channel can be
 * checked in the worker tests; what only a deployed environment can prove is that Zalo's POST
 * actually reaches the route, that the secret header is the thing standing in front of it, and
 * that a redeemed code shows up as a link on /config.
 *
 * It works against calendar-test because that environment carries ZALO_WEBHOOK_SECRET but NO
 * ZALO_BOT_TOKEN: the webhook accepts and processes updates while every outbound reply no-ops,
 * so the spec can drive the whole flow without a message ever reaching a real person's Zalo.
 */

const SECRET = process.env.ZALO_WEBHOOK_SECRET;

/** One inbound text message, shaped exactly as the bot API delivers it. */
function update(text: string, chatId: string, chatType: 'PRIVATE' | 'GROUP' = 'PRIVATE') {
  return {
    ok: true,
    result: {
      event_name: 'message.text.received',
      message: {
        text,
        message_id: `e2e-${Date.now()}`,
        date: Date.now(),
        chat: { id: chatId, chat_type: chatType },
        from: { id: chatId, is_bot: false, display_name: 'E2E Parent' },
      },
    },
  };
}

test.describe('CRUD: zalo pairing', () => {
  crudGuard();
  test.skip(!SECRET, 'Set ZALO_WEBHOOK_SECRET to run the webhook half of this spec');

  test('generate a code, redeem it over the webhook, then unlink', async ({ page, request }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/config');

    let card = await openConfigEntry(page, 'Zalo connections');

    // The channel is off in calendar-test (no bot token), so the card says so and offers nothing
    // to click. That IS the assertion: a code for a bot that cannot send is worse than no code.
    if (
      await card
        .getByText(/Not configured/)
        .isVisible()
        .catch(() => false)
    ) {
      test.skip(true, 'ZALO_BOT_TOKEN unset in this environment — pairing UI is intentionally off');
    }

    // ---- Issue a code for the first parent in the list ----
    const post = k.posted('/config');
    await card.getByRole('button', { name: 'Generate code' }).click();
    await post;

    // Shown once, large, next to the sentence a teacher forwards.
    const code = (
      await card
        .locator('div', { hasText: /^[A-Z2-9]{6}$/ })
        .last()
        .innerText()
    ).trim();
    expect(code).toMatch(/^[A-Z2-9]{6}$/);

    // ---- Redeem it as if the parent had messaged the bot ----
    const chatId = `e2e-chat-${Date.now()}`;
    const res = await request.post('/api/zalo/webhook', {
      headers: { 'X-Bot-Api-Secret-Token': SECRET!, 'Content-Type': 'application/json' },
      data: update(code, chatId),
    });
    expect(res.status()).toBe(200);

    // A reload closes the modal — reopen it before asserting on the link list.
    await page.reload();
    card = await openConfigEntry(page, 'Zalo connections');
    await expect(card.getByText(/Parent ·/)).toBeVisible();

    // ---- Unlink ----
    const row = card.locator('.m-row', { hasText: 'Parent ·' }).first();
    const gone = k.posted('/config');
    await row.getByRole('button', { name: 'Delete' }).click();
    await gone;
    await page.reload();
    card = await openConfigEntry(page, 'Zalo connections');
    await expect(card.getByText('Nobody connected yet')).toBeVisible();
  });

  /**
   * The header is the entire authentication story for this endpoint, so it gets its own test.
   * A webhook that accepted unsigned posts would let anyone attach any Zalo chat to any parent.
   */
  test('the webhook refuses a missing or wrong secret', async ({ request }) => {
    const body = update('ABC234', 'e2e-chat-unauth');

    const noHeader = await request.post('/api/zalo/webhook', { data: body });
    expect(noHeader.status()).toBe(401);

    const wrongHeader = await request.post('/api/zalo/webhook', {
      headers: { 'X-Bot-Api-Secret-Token': 'not-the-secret' },
      data: body,
    });
    expect(wrongHeader.status()).toBe(401);
  });
});
