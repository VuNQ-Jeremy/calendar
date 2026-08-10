import { test, expect, type Locator, type Page } from '@playwright/test';

/**
 * Shared plumbing for the CRUD specs (crud-*.spec.ts).
 *
 * These specs create, edit and DELETE real rows through the UI, so they only
 * ever run against the isolated calendar-test environment — never against the
 * production deployment the school is using. `npm run test:e2e:staging` sets
 * everything up (fresh seed data included); a bare `npm run test:e2e` skips
 * them because E2E_BASE_URL then points at production.
 */

const EMAIL = process.env.MOCHI_EMAIL;
const PASSWORD = process.env.MOCHI_PASSWORD;

const base = process.env.E2E_BASE_URL ?? '';
const isTestEnv = base.includes('calendar-test') || process.env.E2E_ALLOW_CRUD === '1';

/** Call at the top of every CRUD describe block. */
export function crudGuard() {
  test.skip(
    !isTestEnv,
    'CRUD specs write and delete data — run them via `npm run test:e2e:staging` ' +
      '(or set E2E_ALLOW_CRUD=1 against a database you own).',
  );
  test.skip(!EMAIL || !PASSWORD, 'Set MOCHI_EMAIL and MOCHI_PASSWORD to run these');
}

async function signIn(page: Page, email: string, password: string) {
  // The app renders English by default (language only changes via a post-mount
  // localStorage read); pin it anyway so a stray toggle can't break selectors.
  await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
  await page.goto('/login');
  await page.fill('input[name="email"]', email);
  await page.fill('input[name="password"]', password);
  await page.click('form[action="/login"] button[type="submit"]');
  await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
  await expect(page.locator('.sb')).toBeVisible();
}

export async function signInStaff(page: Page) {
  await signIn(page, EMAIL!, PASSWORD!);
}

/**
 * Expand every sidebar section, for specs that click or read rows across
 * several of them.
 *
 * Each page load expands exactly one section — the one owning the current route
 * — and discards any stored collapse state (src/lib/sidebar-nav.tsx), so seeding
 * localStorage before first paint does NOT work. Click the headers instead, and
 * re-run this after any full page load (`page.goto`/`reload`), which resets it.
 */
export async function expandAllNavSections(page: Page) {
  const headers = page.locator('.sb__section[aria-expanded="false"]');
  // Headers are stable; loop by index rather than re-querying a shrinking list.
  for (let i = (await headers.count()) - 1; i >= 0; i--) {
    const h = headers.nth(0);
    if ((await h.count()) === 0) break;
    await h.click();
  }
  await expect(page.locator('.sb__section[aria-expanded="false"]')).toHaveCount(0);
}

/**
 * Open one of /config's settings and return its modal.
 *
 * The page is a list of rows, one per setting; the controls only exist while the row's modal is
 * open. Anything that reloads the page (a persistence check) closes it, so call this again after.
 * `title` is matched exactly against the row title, which is also the modal title.
 */
export async function openConfigEntry(page: Page, title: string): Promise<Locator> {
  await page.locator(`.cfg-row:has(.lrow__title:text-is("${title}"))`).click();
  const dlg = page.locator(`.m-dialog:has(.m-dialog__title:text-is("${title}"))`);
  await expect(dlg).toBeVisible();
  return dlg;
}

/** The seeded student account (vunq@mochi.edu = Leo Park, in Biology 9A). */
export async function signInStudent(page: Page) {
  await signIn(
    page,
    process.env.MOCHI_STUDENT_EMAIL!,
    process.env.MOCHI_STUDENT_PASSWORD ?? PASSWORD!,
  );
}

/**
 * Selector kit for the app's UI primitives (src/ui.tsx, src/ds/bundle.js).
 *
 * The screens build FormData in JS — there are no <form> elements, no `name=`
 * attributes, and labels are not associated with inputs — so everything is
 * located structurally. Two rules the kit encodes:
 *
 *  - Dialogs close optimistically BEFORE the server responds, so after a
 *    save/delete always await `posted(...)` (the POST to the route's .data
 *    endpoint) and then assert on the re-rendered list.
 *  - Comboboxes, date pickers and token menus are portalled to document.body,
 *    so option lists are located from `page`, never from inside the dialog.
 */
export function ui(page: Page) {
  /** Field helpers scoped to an arbitrary root (a dialog, a card, the page). */
  const on = (root: Locator | Page) => {
    const field = (label: string) =>
      root.locator(`.mochi-field:has(> label.mochi-field__label:text-is("${label}"))`);
    const textIn = (label: string) =>
      field(label).locator('input.mochi-input, textarea.mochi-input');
    const pickSel = async (label: string, option: string) => {
      // A dialog re-render (fetcher revalidation, live update) can detach the
      // portalled menu mid-click — reopen and retry once before giving up.
      for (let attempt = 0; ; attempt++) {
        try {
          await field(label).locator('button.m-select__trigger').click();
          // Exact match: hasText is substring + case-insensitive ("Mother"
          // would swallow a pick of "Other").
          await page
            .getByRole('option', { name: option, exact: true })
            .first()
            .click({ timeout: 5_000 });
          return;
        } catch (err) {
          if (attempt >= 2) throw err;
          await page.keyboard.press('Escape'); // close a half-open menu
        }
      }
    };
    return { field, textIn, pickSel };
  };

  // NOTE: matches every open dialog — with stacked dialogs (confirms, nested
  // modals) scope with dlgOf(title) instead.
  const dlg = page.locator('.m-dialog[role="dialog"]');
  const dlgOf = (title: string) =>
    page.locator(`.m-dialog:has(.m-dialog__title:text-is("${title}"))`);
  const submit = () => dlg.locator('.m-dialog__foot .mochi-btn.is-primary');
  /** Resolves when the route action's POST round-trips OK. */
  const posted = (path: string) =>
    page.waitForResponse(
      (r) =>
        r.request().method() === 'POST' && new URL(r.url()).pathname === `${path}.data` && r.ok(),
    );

  return { ...on(dlg), on, dlg, dlgOf, submit, posted };
}
