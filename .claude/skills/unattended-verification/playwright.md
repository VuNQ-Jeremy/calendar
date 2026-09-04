# Playwright and curl against the deployed Worker

There is no local dev server in this project. Everything below runs against a deployment: prod
(`https://calendar.ngqv0712.workers.dev`, read-mostly) or calendar-test
(`https://calendar-test.ngqv0712.workers.dev`, the only place CRUD specs run). Config:
`playwright.config.ts` — 1 worker, 1 retry, 90 s timeout, viewport 1400×900, system Edge channel
(`E2E_CHANNEL=chromium` after `npx playwright install chromium` for the bundled build).

## A. Writing an e2e spec (`e2e/crud-<feature>.spec.ts`)

The helper kit `e2e/crud-helpers.ts` encodes the UI contract; a spec that bypasses it breaks on
the next copy change. The recipe:

```ts
import { test, expect } from '@playwright/test';
import { crudGuard, signInStaff, ui } from './crud-helpers';

test.describe('CRUD: <feature>', () => {
  crudGuard();                                   // skips unless E2E_BASE_URL contains calendar-test
  test('<object>: create, edit, delete', async ({ page }) => {
    const k = ui(page);
    const name = `E2E <object> ${Date.now()}`;   // unique; never a seeded fixture's name
    await signInStaff(page);                     // handles the Zalo-default /login tab
    await page.goto('/<route>');
    await page.getByRole('button', { name: '<New …>', exact: true }).click();
    const dlg = k.dlgOf('<Dialog title>');
    await k.on(dlg).textIn('<Field label>').fill(name);    // inputs located by .mochi-field label — no name= attrs
    await k.on(dlg).pickSel('<Combobox label>', '<Option>');   // menus portal to document.body
    const p = k.posted('/<action-route>');                 // ARM before the click: dialogs close optimistically
    await k.submit().click();                                // the dialog's primary footer button
    await p;
    await expect(page.getByText(name, { exact: true })).toBeVisible();   // getByText is a substring match
    // … edit variant …
    const p2 = k.posted('/<action-route>');
    await k.confirmDanger('<Confirm title>').click();      // useConfirm renders INLINE inside the list dialog
    await p2;
    await expect(page.getByText(name, { exact: true })).toHaveCount(0);
  });
});
```

Same commit, always: the `DELETE FROM <table>;` line in `scripts/test-accounts.sql` for any new
table the spec writes to, and the walkthrough story in `shared/walkthrough.ts` (goto first, values
prefixed `WALKTHROUGH`, cleanup last; bump the count in `test/walkthrough.test.ts`).

Things that read wrong and are not bugs: a student hitting a staff route is **302 → /vocabulary**
(not 403); `.data` POST bodies are turbo-stream, so never `.json()` them — `k.posted()` checks
status only; DS checkboxes hide the native input (click the `.mochi-check` chip); `.m-board__body`
changes overflow under 1440 px by design; `trace: retain-on-failure` instruments only the default
`page` context, so a spec's own `browser.newContext()` leaves no trace.

## B. Screenshotting a deployed page (no suite, no grant needed for read-only)

Write the script in the scratchpad, not the repo. A bare `import 'playwright'` cannot resolve from
there; the `file://` URL does (verified 2026-09-04).

```js
import { chromium } from 'file:///F:/code/calendar/node_modules/playwright/index.mjs';
const BASE = 'https://calendar.ngqv0712.workers.dev';
const OUT = '<scratchpad or docs/superpowers/reviews/<date>-<feature>-smoke>/';
const browser = await chromium.launch({ channel: 'msedge' });
const page = await (await browser.newContext({ viewport: { width: 1400, height: 900 } })).newPage();
await page.addInitScript(() => localStorage.setItem('mochi_lang_v1', 'en'));
await page.goto(`${BASE}/login`);
await page.getByRole('button', { name: 'Email', exact: true }).click();   // /login lands on the Zalo tab
await page.fill('input[name="email"]', 'dev@mochi.edu');
await page.fill('input[name="password"]', 'mochi123');
await page.click('form[action="/login"] button[type="submit"]');
await page.waitForURL(/\/(dashboard|vocabulary)/, { timeout: 30_000 });
console.log('stamp', await page.locator('.sb__version').innerText());   // "v0.NNNN · <sha>" — must be your sha
await page.goto(`${BASE}/<route>`);
await page.getByRole('button', { name: '<Open dialog>', exact: true }).click();
const dlg = page.locator('.m-dialog').first();
await dlg.waitFor();
console.log('dialog box', await dlg.boundingBox());       // y + height <= 900, or the footer is below the fold
await dlg.screenshot({ path: `${OUT}01-dialog.png` });
await page.evaluate(() => localStorage.setItem('mochi_lang_v1', 'vi')); await page.reload();  // vi pass: raw keys show here
await browser.close();
```

Then **Read each PNG** and write one line per image into the log. A screenshot nobody looked at
verified nothing. When the script writes (a prod smoke fixture), every value is `WALKTHROUGH`-
prefixed and the cleanup half of the script is written before the create half is run.

## C. Running the staging suite from a plan

Grant needed in §0.2: `npm run test:env:setup` **and** `npm run test:e2e:staging`. Setup deploys
calendar-test with `CLOUDFLARE_ENV=test` at build time and applies migrations to `mochi-class-test`;
after any migration, setup and suite run as a pair or the Worker and schema disagree for hours.
`npm run test:e2e:staging` resets the seed data first, then runs; single spec:
`npm run test:e2e:staging -- e2e/<spec>.spec.ts` (or `-- --grep "<title>"`). Never `wrangler deploy
--env test` (ships prod bindings). Never `--headed` unattended.

Reading the result:
1. Compare every failure to §0.4 by **spec file + test title**. Two zalo specs skip without
   `ZALO_BOT_TOKEN`; a `flaky` that passed on retry is not a failure.
2. Before diagnosing anything else: open `test-results/<spec>/error-context.md`, find the sidebar
   stamp `v0.NNNN · <sha>`. Not your sha → another session redeployed calendar-test; rerun setup +
   that spec, do not debug.
3. Your sha, still red: read the trace and the spec's source; fix; `npm run test:env:setup` again
   if the fix touched server code; rerun the single spec. Three laps, then `test.fixme` + log.
4. Never rerun the full suite to "confirm" a count, never edit §0.4 to make the run look clean.

Deploy-live probe for prod (Workers Builds, 10–15 min after push; a green GitHub Action is not the
deploy): poll a route that exists only in the new bundle — `404` old, `302` new — or the stamp in
the SSR HTML with the cookie from §D. Poll with the Monitor tool or a `run_in_background` loop.

## D. curl against authenticated routes

```bash
BASE=https://calendar.ngqv0712.workers.dev
TOKEN=$(curl -s -X POST "$BASE/api/auth/login" -H 'Content-Type: application/json' \
  -d '{"email":"dev@mochi.edu","password":"mochi123"}' | grep -o '"token":"[^"]*"' | cut -d'"' -f4)
ENC=$(printf '"%s"' "$TOKEN" | base64 -w0 | sed 's/+/%2B/g; s#/#%2F#g; s/=/%3D/g')   # cookie = urlencode(base64(JSON.stringify(token)))
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/<route>" -H "Cookie: __mochi_session=$ENC"     # 200
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/<route>" -H "Authorization: Bearer $TOKEN"  # 200 — /api/* is bearer-only
curl -s -o /dev/null -w "%{http_code}\n" "$BASE/api/<route>"                                    # 401
# a route action:
curl -s -H "Cookie: __mochi_session=$ENC" "$BASE/<action-route>.data" \
  --form-string intent=<intent> --form-string <field>=<value> | head -c 200; echo
```

Two kinds of action route, told apart by reading the file: a **page action** (`export async function
action` that returns data for a page) is posted to `<path>.data` and answers turbo-stream; a
**resource route** that returns `Response.json(...)` (for example `app/routes/practice-actions.tsx`)
is posted to its bare path and answers plain JSON you may parse.

Rules that each cost a cycle: `--form-string`, never `-F` (it strips wrapping quotes); non-ASCII
values go in a file (`-F "field=<path"`) because the tool argument layer mangles them; **never
`-o /dev/null` an action** — a Zod 400 and a success look identical from outside; success is
`[…,"ok",true]`, a redirect is HTTP **202** and is not a write; a cleared optional field arrives as
`''`, not absent. For `node -e`, `/tmp` resolves to `F:\tmp` — use the scratchpad.
