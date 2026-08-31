import { test, expect, type Page } from '@playwright/test';
import { crudGuard, signInStaff, signInStudent, ui } from './crud-helpers';

/**
 * /walkthrough — the admin-only product walkthrough, both halves of it.
 *
 * The feature is two windows talking to each other. The CHECKLIST (app/routes/walkthrough.tsx +
 * src/walkthrough/walkthrough-screen.tsx) lists the 27 stories of shared/walkthrough.ts and owns
 * the run; pressing Run mints a token and `window.open`s the story's route as `?tour=<token>`. The
 * DRIVER (src/walkthrough/tour-driver.tsx), mounted globally in the app shell, wakes up in THAT
 * window only, spotlights each step's control, pre-fills placeholder values and posts a `tick` back
 * over the BroadcastChannel whenever it can observe a step completing. So the interesting assertions
 * here are cross-window ones, and a single-page spec could not make them.
 *
 * WHAT THIS ASSERTS, and why each one is here rather than in a unit test:
 *  - the admin gate, because a hidden nav row is not a permission;
 *  - that the catalogue renders as cards, including the "no spec" badge, which is a deliberate
 *    coverage-gap signal and would be invisible if it silently stopped rendering;
 *  - that progress survives a reload and that Reset clears it — the notes live in localStorage
 *    (`mochi_walkthrough_v1`), so a reload is the only honest way to prove the write happened;
 *  - and, the one that matters most, a real tour of the exemplar story `setup-class`: the popup
 *    carries a `tour=` token, the driver's native-setter prefill actually reaches React's
 *    controlled state, and a real save round-trip auto-ticks the matching `submit` step in the
 *    OTHER window.
 *
 * WHAT IT DOES NOT ASSERT. The spotlight geometry (rect maths against a live layout), the coach
 * bubble's top/bottom flip, and the 24 stories that are not `setup-class`. Walking all 27 stories
 * through their real screens would be a second copy of the whole CRUD suite; the catalogue's value
 * is that those flows are already covered by the specs each story names.
 *
 * THE DRIVER NEVER CLICKS. Every real action below is performed by the test the way a human would
 * perform it — including picking Grade and Level, which the catalogue writes as a `check` step
 * precisely because those menus are portalled to document.body and the driver refuses to guess.
 *
 * FIXED PLACEHOLDER DATA. The driver types `WALKTHROUGH 7A`, not a `${Date.now()}` name — that is
 * the product's choice (WT_PREFIX exists so an admin can grep for what a tour left behind), so this
 * spec cannot lean on unique names to stay independent of its own past runs. Instead it SWEEPS every
 * class whose name contains WALKTHROUGH before it creates one, and sweeps again in a `finally`.
 * The leading sweep is the real guarantee: a run that dies mid-test (a timeout leaves no budget for
 * the trailing sweep either) still cannot poison the next one.
 */

/** The exemplar story, verbatim from shared/walkthrough.ts. */
const STORY = 'Create a class and enroll a student';
/** A story with `specs: []` — the "no spec" badge is what it exists to prove. */
const STORY_NO_SPEC = 'Update my profile details';
/** The value the driver's `fill` step types into the New class dialog. */
const WT_CLASS = 'WALKTHROUGH 7A';

/**
 * Step indices in `setup-class`, which the cross-window assertions read by position.
 *
 * They are positions in the catalogue array, so they are stated once here: if a step is inserted the
 * spec fails on the wrong step's kind chip rather than silently asserting about something else.
 */
const STEP = {
  goto: 0,
  clickNew: 1,
  fill: 2,
  cohort: 3, // 'check' — Grade + Level, which the driver deliberately cannot drive
  save: 4, // 'submit' → /classes
  verify: 5, // 'check' — nothing observes it, so nothing may tick it
} as const;

/** The story card, by its title. Collapsed by default; `openStory` expands it. */
const storyCard = (page: Page, title: string) =>
  page.locator(`.wt-story:has(.wt-story__title:text-is("${title}"))`);

async function openStory(page: Page, title: string) {
  const card = storyCard(page, title);
  await expect(card).toBeVisible();
  const toggle = card.locator('.wt-story__toggle');
  if ((await toggle.getAttribute('aria-expanded')) !== 'true') await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  return card;
}

/** The hidden native input of one step's checkbox. `toBeChecked` is the matcher that tolerates it. */
const stepBox = (card: ReturnType<typeof storyCard>, idx: number) =>
  card.locator('.wt-step').nth(idx).locator('input[type="checkbox"]');

/**
 * Delete every class the walkthrough may have left behind.
 *
 * Substring, not exact: `setup-class` names one class, but WT_PREFIX is the contract for all of
 * them, and a sweep that missed `WALKTHROUGH 7B` would leave the next run's list ambiguous.
 */
async function sweepWalkthroughClasses(page: Page) {
  const k = ui(page);
  await page.goto('/classes');
  await expect(page.getByRole('button', { name: 'New class' })).toBeVisible();

  const stale = page.locator('.mochi-card:has(h3:has-text("WALKTHROUGH"))');
  // Bounded: a runaway loop here would burn the whole test budget deleting nothing.
  for (let i = 0; i < 10 && (await stale.count()) > 0; i++) {
    await stale.first().getByRole('button', { name: 'Delete' }).click();
    const post = k.posted('/classes');
    await k.confirmDanger('Delete class?').click();
    await post;
  }
  await expect(stale).toHaveCount(0);
}

test.describe('CRUD: walkthrough', () => {
  crudGuard();

  test('is admin-only: a student never reaches the checklist', async ({ page }) => {
    await signInStudent(page);
    // requireAdmin = requireStaff (a 302 that redirects any NON-staff actor away, BEFORE any role
    // check runs) + a 403 role check only staff ever reach. A student is turned away by the first
    // half, so what a browser actually sees is the redirect's landing page, not a bare 403 —
    // asserting on the redirect is what proves denial. Same reasoning as crud-activity.spec.ts.
    await page.goto('/walkthrough');
    await expect(page).not.toHaveURL(/\/walkthrough/);
    await expect(page.getByRole('heading', { name: 'Walkthrough', level: 1 })).toHaveCount(0);
    await expect(page.locator('.wt-story')).toHaveCount(0);
  });

  test('renders the catalogue: journeys, tags, spec chips and the coverage gap', async ({
    page,
  }) => {
    await signInStaff(page);
    await page.goto('/walkthrough');
    await expect(page.getByRole('heading', { name: 'Walkthrough', level: 1 })).toBeVisible();

    // Three role sections (Staff / Student / Parent), each of the seven journeys under one of them.
    await expect(page.locator('.wt-role__title')).toHaveText(['Staff', 'Student', 'Parent']);
    const journeys = page.locator('.wt-journey');
    const journeyCount = await journeys.count();
    // >= rather than == : the catalogue is expected to grow, and what this test is about is that
    // no journey renders as an empty heading with nothing under it.
    expect(journeyCount).toBeGreaterThanOrEqual(7);
    for (let i = 0; i < journeyCount; i++) {
      await expect(journeys.nth(i).locator('.wt-story').first()).toBeVisible();
    }

    // The exemplar, with the two pieces of DATA the card carries beyond its title.
    const card = await openStory(page, STORY);
    await expect(card.locator('.wt-tag--write')).toHaveText('write');
    await expect(card.locator('.wt-acct')).toHaveText('staff');
    await expect(card.locator('.wt-spec')).toHaveText(['crud-people2.spec.ts']);
    await expect(card.locator('.wt-spec--none')).toHaveCount(0);

    // A story with `specs: []` says so. Not decoration: it is the catalogue admitting that nothing
    // automated is watching that flow, which is exactly the story to be slow and suspicious about.
    const uncovered = await openStory(page, STORY_NO_SPEC);
    await expect(uncovered.locator('.wt-spec--none')).toHaveText('no spec');
  });

  test('progress survives a reload, and Reset clears it', async ({ page }) => {
    const k = ui(page);
    await signInStaff(page);
    await page.goto('/walkthrough');

    let card = await openStory(page, STORY);
    await expect(stepBox(card, 0)).not.toBeChecked();
    // The DS checkbox hides its native input behind a styled span, so ticking clicks the LABEL and
    // asserting reads the input (crud-garden.spec.ts documents the same pair).
    await card.locator('.wt-step').nth(0).locator('label.mochi-check').click();
    await expect(stepBox(card, 0)).toBeChecked();

    // A full reload: the notes are in localStorage, so nothing but a fresh document proves they
    // were written rather than merely held in React state. Expansion is NOT persisted — it is
    // per-render UI state — so the card has to be re-opened.
    await page.reload();
    card = await openStory(page, STORY);
    await expect(stepBox(card, 0)).toBeChecked();

    // Reset goes through the app's own confirm dialog (useConfirm, src/ui.tsx) — NOT a native
    // `confirm()`, so there is no `page.on('dialog')` here and a handler waiting for one would
    // hang forever.
    await page.locator('.wt-head-meter').getByRole('button', { name: 'Reset' }).click();
    await k.confirmDanger('Reset the walkthrough?').click();
    await expect(k.dlgOf('Reset the walkthrough?')).toHaveCount(0);
    await expect(stepBox(card, 0)).not.toBeChecked();

    // And it removed the key rather than storing an empty map, so a reload finds nothing to restore.
    await page.reload();
    card = await openStory(page, STORY);
    await expect(stepBox(card, 0)).not.toBeChecked();
  });

  test('Run opens a tour window, the driver prefills it, and a real save ticks the step back', async ({
    page,
  }) => {
    await signInStaff(page);
    // Leading sweep — see the file header. The driver types a FIXED name, so a crashed previous run
    // is the normal failure mode, not an exotic one.
    await sweepWalkthroughClasses(page);

    await page.goto('/walkthrough');
    const card = await openStory(page, STORY);

    try {
      const [popup] = await Promise.all([
        page.waitForEvent('popup'),
        card.getByRole('button', { name: 'Run', exact: true }).click(),
      ]);

      // The route the story declares, PLUS a token. The token is the whole security model of the
      // channel: a BroadcastChannel reaches every same-origin tab, and a window without a matching
      // `?tour=` is inert — which is what stops a stale background tab sitting on /classes from
      // posting a tick for a step no human performed.
      await expect(popup).toHaveURL(/\/classes\?tour=/);
      const token = new URL(popup.url()).searchParams.get('tour');
      expect(token).toBeTruthy();
      expect(token!.length).toBeGreaterThan(8);

      const kp = ui(popup);

      // The handshake: the driver reports `ready` on the story's route and the checklist ticks the
      // `goto` step in THIS window. Nothing in the popup was clicked to make that happen.
      await expect(stepBox(card, STEP.goto)).toBeChecked();

      // Step 2 — the user's click. `opensDialog` means the driver ticks it when the dialog appears.
      await popup.getByRole('button', { name: 'New class' }).click();
      await expect(kp.dlgOf('New class')).toBeVisible();
      await expect(stepBox(card, STEP.clickNew)).toBeChecked();

      // THE assertion this whole spec exists for. Every text input in the app is a controlled React
      // input; a plain `el.value = x` would be overwritten by React's next render and the draft
      // would never hold the value at all. The driver goes around the value tracker with the native
      // setter + a bubbling `input` event, and this is the only place in the suite that proves that
      // path reaches React's state — the value is READ back, not typed.
      await expect(kp.textIn('Class name')).toHaveValue(WT_CLASS);
      await expect(stepBox(card, STEP.fill)).toBeChecked();

      // Grade and Level are ours: their menus portal to document.body, so the catalogue writes them
      // as a `check` step. Save class stays disabled until both are set — which is what makes that
      // step's warning text true, so assert it rather than trusting the prose.
      await expect(kp.submit()).toBeDisabled();
      await kp.pickSel('Grade', 'Khối 6');
      await kp.pickSel('Level', 'Cơ bản');
      await expect(kp.submit()).toBeEnabled();

      // A `check` step ticks only when a human says so. Until it does, the driver is still ON that
      // step and would not be watching for the save at all — so pressing Next in the coach bubble
      // is not decoration here, it is what arms the next assertion.
      const coach = popup.locator('.tourd-coach');
      await expect(coach.locator('.tourd-coach__step')).toHaveText(/^Step 4 of \d+$/);
      await coach.getByRole('button', { name: 'Next', exact: true }).click();
      await expect(stepBox(card, STEP.cohort)).toBeChecked();
      await expect(coach.locator('.tourd-coach__step')).toHaveText(/^Step 5 of \d+$/);

      // The real save. The dialog closes optimistically, so gate on the POST before reading the
      // list — and the driver watches React Router's own fetcher state for the same round trip.
      const post = kp.posted('/classes');
      await kp.submit().click(); // "Save class"
      await post;
      await expect(popup.locator(`.mochi-card:has(h3:text-is("${WT_CLASS}"))`)).toBeVisible();

      // Cross-window: the save in the popup ticked the `submit` step on the CHECKLIST.
      await expect(stepBox(card, STEP.save)).toBeChecked();
      // And nothing ticked the step after it. The next step is a `check` — a tick there could only
      // have come from the driver mistaking this save for the next one (the falling-edge detection
      // noted in the tour-driver's submit effect), and a step silently marked done is the worst
      // thing this feature can produce.
      await expect(stepBox(card, STEP.verify)).not.toBeChecked();

      // Stop from the coach bubble — the driver's own exit, and the one part of the overlay that
      // takes pointer events. With it gone the popup is an ordinary /classes window again, which is
      // what makes the cleanup below a plain UI delete rather than a fight with the spotlight.
      await coach.getByRole('button', { name: 'Stop', exact: true }).click();
      await expect(popup.locator('.tourd')).toHaveCount(0);
      await expect(card.locator('.wt-story__live')).toHaveCount(0);
      // Re-read the step after the save: a late tick would have had the whole Stop round trip to
      // arrive, and this is the only window in which one could still show up.
      await expect(stepBox(card, STEP.verify)).not.toBeChecked();

      // Cleanup through the popup's real UI, as a walkthrough's own last two steps would.
      const created = popup.locator(`.mochi-card:has(h3:text-is("${WT_CLASS}"))`);
      await created.getByRole('button', { name: 'Delete' }).click();
      const del = kp.posted('/classes');
      await kp.confirmDanger('Delete class?').click();
      await del;
      await expect(created).toHaveCount(0);
    } finally {
      // Belt to the braces above: an assertion that fails before the delete must not leave a row
      // for the next run. (A failure that ate the whole timeout leaves this no budget either —
      // which is why the leading sweep, not this block, is what actually guarantees a clean start.)
      await sweepWalkthroughClasses(page);
    }
  });
});
