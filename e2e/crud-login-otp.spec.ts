import { test, expect } from '@playwright/test';
import { crudGuard } from './crud-helpers';

/**
 * Zalo OTP login/recovery, driven anonymously against the seeded phone `+84900000001`
 * (scripts/test-accounts.sql): the SAME number is the login phone on both the seeded student
 * account (acc-e2e-student-0001, linked to s1 "Leo Park") and the seeded parent account
 * (acc-e2e-parent-0001, "Mina Park") — the shape that makes the picker reachable.
 *
 * The plaintext code only ever appears because calendar-test carries AUTH_DEV_CODES=1
 * (wrangler.jsonc env.test) — see server/services/login-otp.ts. Never set that flag anywhere
 * but a test environment.
 */

test.describe('CRUD: Zalo OTP login', () => {
  crudGuard();

  test('code first, then picker: verifying a shared phone lists both accounts', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');

    // The Zalo tab is the default landing screen — no tab click needed.
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
    await page.locator('input[placeholder="0901 234 567"]').fill('0900000001');
    const requestRes = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login.data',
    );
    await page.getByRole('button', { name: 'Send code' }).click();
    const body = (await (await requestRes).json()) as { devCode?: string | null };
    expect(body.devCode).toBeTruthy();

    await expect(page.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeVisible();
    await page.locator('input[placeholder="000000"]').fill(body.devCode!);
    await page.getByRole('button', { name: 'Verify' }).click();

    // Two accounts share this phone — the code alone is not enough to sign in yet.
    await expect(page.getByRole('heading', { name: 'Which account is this?' })).toBeVisible();
    const pickItems = page.locator('.auth-pick-item');
    await expect(pickItems).toHaveCount(2);
    const names = (await pickItems.allInnerTexts()).join(' ');
    expect(names).toContain('Leo Park');
    expect(names).toContain('Mina Park');

    await pickItems.filter({ hasText: 'Leo Park' }).click();
    await page.waitForURL(/\/vocabulary/, { timeout: 30_000 });
  });

  test('a wrong code five times kills the challenge, even for the right code after', async ({
    page,
  }) => {
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');
    await page.locator('input[placeholder="0901 234 567"]').fill('0900000001');
    const requestRes = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login.data',
    );
    await page.getByRole('button', { name: 'Send code' }).click();
    const { devCode } = (await (await requestRes).json()) as { devCode: string };

    for (let i = 0; i < 5; i++) {
      await page.locator('input[placeholder="000000"]').fill('000000');
      await page.getByRole('button', { name: 'Verify' }).click();
      await expect(page.locator('.auth-error')).toBeVisible();
    }

    // The 6th attempt is the RIGHT code, but the challenge is already dead.
    await page.locator('input[placeholder="000000"]').fill(devCode);
    await page.getByRole('button', { name: 'Verify' }).click();
    await expect(page.locator('.auth-error')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'Which account is this?' })).toHaveCount(0);
  });

  test('an unregistered phone shows the identical generic screen', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
    await page.goto('/login');
    await page.locator('input[placeholder="0901 234 567"]').fill('0999999999');
    const requestRes = page.waitForResponse(
      (r) => r.request().method() === 'POST' && new URL(r.url()).pathname === '/login.data',
    );
    await page.getByRole('button', { name: 'Send code' }).click();
    const body = (await (await requestRes).json()) as { challengeId?: string; devCode?: string };

    // Same shape as a real request: a challengeId, and — the enumeration-safety property —
    // no code, because there is nothing real to disclose.
    expect(body.challengeId).toBeTruthy();
    expect(body.devCode).toBeFalsy();
    await expect(page.getByRole('heading', { name: 'Enter the 6-digit code' })).toBeVisible();
    await expect(page.getByText('If this number is registered, a code has been sent via Zalo.')).toBeVisible();
  });
});
