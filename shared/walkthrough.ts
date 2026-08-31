/**
 * The walkthrough catalogue — every user story in the product, as data.
 *
 * This is the data foundation for the admin-only "walkthrough" surface: a checklist screen that
 * lists every story, and a tour driver that opens the target screen in a second window, spotlights
 * the next control and pre-fills placeholder inputs. Both consume this file and nothing else, so
 * the shape here is the contract between them.
 *
 * PURITY. No React, no DOM, no `server/` imports, no JSX, no icon components — the same rule
 * `shared/logic/rankings.ts` states and for the same reason: `shared/` is a `file:` dependency of
 * `mobile/`, which has to import from here without dragging in Workers types or a renderer. A step
 * therefore describes its target *structurally* (a button's accessible name, a field's label text,
 * a CSS escape hatch) and leaves every act of querying to the driver.
 *
 * ENGLISH ONLY, deliberately. There are no `t()` calls and no i18n keys in this file, and there
 * must not be any. The walkthrough is an admin surface, and — more to the point — the strings below
 * ARE the selectors: `{ button: 'Save class' }` only finds anything while the app renders English.
 * That is exactly the contract `e2e/crud-helpers.ts` relies on (it pins `mochi_lang_v1` to `en`
 * before first paint for the same reason). Translating a step title would be harmless; translating
 * a target would silently break the tour, and the two are the same string in the same object, so
 * the honest rule is that none of it is translated.
 *
 * WHERE THE STRINGS COME FROM. Every `click` / `fill` / `submit` target below was read out of the
 * e2e spec named in that story's `specs` list, or — where the spec did not exercise it — out of the
 * screen source and `shared/i18n/strings.ts`. Nothing here is guessed. A control whose real label
 * could not be confirmed, or that has no stable label at all (a portalled token menu, a file
 * picker, a card body that is its own click target), is written as `kind: 'check'` — a manual tick.
 * A manual tick is a slightly worse walkthrough; a guessed selector is a broken one, so the
 * catalogue leans on `check` heavily and without apology.
 *
 * PLACEHOLDER DATA. Every value the driver types starts with `WT_PREFIX`, so anything the
 * walkthrough leaves behind in a real database is greppable and obviously not a teacher's work.
 * Stories tagged `write` that create a row end on a cleanup step that deletes it again. Stories
 * tagged `caution` touch real production rows (attendance, grades, money) and therefore carry NO
 * driver-mutating step at all: they are `check` steps whose text says what to look at and, where it
 * matters, what not to press. The student progress stories are the deliberate exception to the
 * cleanup rule — `stu-review`, `stu-pvp`, `stu-garden` and `stu-test` write genuine progress for
 * the designated test student (vunq@mochi.edu) and the product offers no delete affordance for it.
 */

/** How the driver finds the thing it is pointing at. */
export type TourTarget =
  /** A button located by its accessible name, matched exactly. */
  | { button: string }
  /** A `.mochi-field` located by its label text, optionally scoped to a `.m-dialog` with this title. */
  | { field: string; dialog?: string }
  /**
   * Escape hatch: a plain CSS selector, resolved with `querySelector`. Use sparingly and say why —
   * it must be a selector a BROWSER understands, so none of Playwright's `:text-is()` /`:has-text()`
   * pseudo-classes that the e2e specs lean on are available here.
   */
  | { css: string };

export type TourStep =
  /** The checklist's Run opens this route; auto-ticks when the driver reports ready on it. */
  | { kind: 'goto'; text: string; route: string }
  /** Spotlight the target; auto-ticks when `opensDialog` appears, otherwise manual. */
  | { kind: 'click'; text: string; target: TourTarget; opensDialog?: string }
  /** The driver pre-fills; auto-ticks once every field holds its value. */
  | { kind: 'fill'; text: string; dialog: string; fields: { field: string; value: string }[] }
  /**
   * Spotlight the submit control; auto-ticks when the POST to `${post}.data` completes AND its
   * result does not look like a failure. "Looks like a failure" means the driver recognised one of
   * the two shapes `app/routes/*.tsx` actions actually return on error — `{ error: string }` or
   * `{ errors: ZodError.flatten() }` — in `fetcher.data` (see `submitFailureMessage` in
   * `src/walkthrough/tour-driver.tsx`). A submission the driver has no way to inspect at all (a
   * full-navigation submit, or a future action shape this file was never taught) still ticks: the
   * fail-safe direction is a missing auto-tick the human ticks by hand, never a false one.
   */
  | { kind: 'submit'; text: string; target: TourTarget; post: string }
  /** Manual tick only — the honest fallback wherever the driver cannot act safely or reliably. */
  | { kind: 'check'; text: string };

export interface TourStory {
  /** kebab-case, unique across the catalogue. */
  id: string;
  /** A `TourJourney.id`. */
  journey: string;
  title: string;
  /** `caution` = touches real production data; its steps must say so and must not mutate. */
  tag: 'read' | 'write' | 'caution';
  /** Where Run opens, e.g. '/classes'. Always equal to `steps[0].route`. */
  route: string;
  account: 'staff' | 'student' | 'parent';
  /** e2e files that automate this flow; `[]` renders a "no spec" badge. */
  specs: string[];
  /** Every story starts with a `goto`. A story that creates rows ends with its cleanup. */
  steps: TourStep[];
}

export interface TourJourney {
  id: string;
  role: 'Staff' | 'Student' | 'Parent';
  title: string;
  desc: string;
}

/**
 * The prefix on every value the driver types.
 *
 * It is not decoration: the walkthrough is meant to be runnable against the real deployment, so the
 * one thing a school's admin must be able to do afterwards is search for `WALKTHROUGH` and find
 * everything the tour touched, whatever went wrong halfway through.
 */
export const WT_PREFIX = 'WALKTHROUGH';

export const JOURNEYS: TourJourney[] = [
  {
    id: 'setup',
    role: 'Staff',
    title: 'Term setup',
    desc: 'Everything a school does once per term, before any lesson runs.',
  },
  {
    id: 'daily',
    role: 'Staff',
    title: 'Daily operations',
    desc: 'The loop a teacher runs every class day.',
  },
  {
    id: 'monthly',
    role: 'Staff',
    title: 'Monthly close',
    desc: 'Money, rankings, the report parents actually see.',
  },
  {
    id: 'content',
    role: 'Staff',
    title: 'Content authoring',
    desc: 'Building the material students learn from.',
  },
  {
    id: 'admin',
    role: 'Staff',
    title: 'Admin & observability',
    desc: 'How you find out what happened and what users want.',
  },
  {
    id: 'student',
    role: 'Student',
    title: 'Student life',
    desc: 'Review, play, watch the garden grow.',
  },
  {
    id: 'parent',
    role: 'Parent',
    title: 'Parent portal',
    desc: 'No seeded parent login on prod — mint one first.',
  },
];

export const STORIES: TourStory[] = [
  // ---------------------------------------------------------------- setup (staff)
  {
    id: 'setup-class',
    journey: 'setup',
    title: 'Create a class and enroll a student',
    tag: 'write',
    route: '/classes',
    account: 'staff',
    specs: ['crud-people2.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Classes', route: '/classes' },
      {
        kind: 'click',
        text: 'Click New class — the tour has the form ready',
        target: { button: 'New class' },
        opensDialog: 'New class',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with placeholder values',
        dialog: 'New class',
        fields: [{ field: 'Class name', value: 'WALKTHROUGH 7A' }],
      },
      {
        kind: 'check',
        text: 'Pick a Grade and a Level yourself — both are required, and Save class stays disabled until they are set. The menus are portalled to the page body, so the tour cannot click them for you.',
      },
      {
        kind: 'submit',
        text: 'Your click, not mine — press Save class',
        target: { button: 'Save class' },
        post: '/classes',
      },
      { kind: 'check', text: 'Verify WALKTHROUGH 7A appears on the list, reading 0 students' },
      { kind: 'goto', text: 'Open People — the Students tab is the default', route: '/people' },
      {
        kind: 'click',
        text: 'Click Add student',
        target: { button: 'Add student' },
        opensDialog: 'Add student',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with placeholder values',
        dialog: 'Add student',
        fields: [{ field: 'Full name', value: 'WALKTHROUGH An' }],
      },
      {
        kind: 'check',
        text: 'Enroll them: type WALKTHROUGH into the class search under Grade & classes and pick WALKTHROUGH 7A from the suggestions. That menu is portalled and closes on an outside click, so it is yours to drive.',
      },
      {
        kind: 'submit',
        text: 'Press Save, then Done on the "Invite codes ready" dialog that follows',
        target: { button: 'Save' },
        post: '/people',
      },
      { kind: 'check', text: 'Back on Classes, WALKTHROUGH 7A now reads 1 student' },
      {
        kind: 'submit',
        text: 'Cleanup 1 of 2: on People, press Delete on WALKTHROUGH An and confirm with Remove',
        target: { button: 'Remove' },
        post: '/people',
      },
      {
        kind: 'submit',
        text: 'Cleanup 2 of 2: on Classes, press Delete on the WALKTHROUGH 7A card and confirm with Delete',
        target: { button: 'Delete' },
        post: '/classes',
      },
    ],
  },
  {
    id: 'setup-config',
    journey: 'setup',
    title: 'Configure assessment types and remark criteria',
    tag: 'write',
    route: '/config',
    account: 'staff',
    specs: ['crud-config.spec.ts', 'crud-config2.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Config', route: '/config' },
      {
        kind: 'check',
        text: 'Open the Assessment types row. Every setting on this page is a row that opens its own modal — the controls only exist while that modal is up.',
      },
      {
        kind: 'click',
        text: 'Click Add type',
        target: { button: 'Add type' },
        opensDialog: 'Add type',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder type name',
        dialog: 'Add type',
        fields: [{ field: 'Type name', value: 'WALKTHROUGH Quiz' }],
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/config' },
      {
        kind: 'check',
        text: 'Drag the new row to reorder it — the order here is the order the assessments screen offers.',
      },
      { kind: 'check', text: 'Close this modal and open the Monthly remark criteria row' },
      {
        kind: 'click',
        text: 'Click Add criterion',
        target: { button: 'Add criterion' },
        opensDialog: 'Add criterion',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder criterion name',
        dialog: 'Add criterion',
        fields: [{ field: 'Criterion name', value: 'WALKTHROUGH Effort' }],
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/config' },
      {
        kind: 'check',
        text: 'Cleanup: delete both placeholder rows (Delete, then confirm with Delete). Leave the six seeded assessment types and four seeded criteria alone — real score rows point at them.',
      },
    ],
  },
  {
    id: 'setup-invite',
    journey: 'setup',
    title: 'Invite a colleague and redeem the code',
    tag: 'write',
    route: '/people',
    account: 'staff',
    specs: ['crud-invite-redeem.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open People', route: '/people' },
      { kind: 'check', text: 'Switch to the Teachers tab' },
      {
        kind: 'click',
        text: 'Click Add teacher',
        target: { button: 'Add teacher' },
        opensDialog: 'Add teacher',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder name',
        dialog: 'Add teacher',
        fields: [{ field: 'Full name', value: 'WALKTHROUGH Invitee' }],
      },
      {
        kind: 'submit',
        text: 'Press Save — adding somebody is what mints their code, and "Invite codes ready" shows it',
        target: { button: 'Save' },
        post: '/people',
      },
      {
        kind: 'check',
        text: 'Copy the XXX-XXX code, press Done, then open the sign-in screen in a private window and press "I have an invite code"',
      },
      {
        kind: 'check',
        text: 'Paste the code, press Continue — the name arrives filled and read-only because the code is linked to the person you just created — set a throwaway email and a password, and press the submit button to join. You land on the dashboard.',
      },
      {
        kind: 'check',
        text: 'Cleanup: back on People → Teachers, press Delete on WALKTHROUGH Invitee and confirm with Remove. The account itself is swept by scripts/test-accounts.sql on the next test-env reset; on production, delete it by hand.',
      },
    ],
  },
  {
    id: 'setup-login',
    journey: 'setup',
    title: 'Sign in three ways: password, OTP, Google',
    tag: 'read',
    route: '/login',
    account: 'staff',
    specs: ['crud-login-otp.spec.ts', 'google-auth.spec.ts'],
    steps: [
      {
        kind: 'goto',
        text: 'Sign out first. /login redirects any signed-in user straight to their dashboard with no query string, so opening this window with Run cannot land you here — the tour cannot drive this story at all. Sign out, then open /login yourself and work through the checks below by hand.',
        route: '/login',
      },
      {
        kind: 'check',
        text: 'Log out and back in with email and password — the heading reads "Welcome back"',
      },
      {
        kind: 'check',
        text: 'OTP: enter a registered phone number and press Send code, then "Enter the 6-digit code" → Verify. The code is delivered over Zalo, not email. A number attached to several people lands on "Which account is this?" first.',
      },
      {
        kind: 'check',
        text: 'Google: on an account that has linked Google, the "Sign in with Google" link appears on this screen. It is absent when the integration is not configured.',
      },
    ],
  },

  // ---------------------------------------------------------------- daily (staff)
  {
    id: 'daily-calendar',
    journey: 'daily',
    title: 'Schedule a session and work its tabs',
    tag: 'write',
    route: '/calendar',
    account: 'staff',
    specs: ['crud-core.spec.ts', 'crud-calendar-drag.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Calendar', route: '/calendar' },
      {
        kind: 'click',
        text: 'Click New event',
        target: { button: 'New event' },
        opensDialog: 'New event',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder title',
        dialog: 'New event',
        fields: [{ field: 'Title', value: 'WALKTHROUGH session' }],
      },
      {
        kind: 'check',
        text: 'Set Date to tomorrow. The picker is portalled to the page body and each day button carries its ISO date, so tomorrow is reachable even in next month’s leading cells.',
      },
      {
        kind: 'submit',
        text: 'Press Add event',
        target: { button: 'Add event' },
        post: '/calendar',
      },
      {
        kind: 'check',
        text: 'In week view, drag the event onto another day. Known wart: mouseup races the drag guard, so the edit dialog usually pops open over the result (memory: mochi-calendar-drag-opens-editor). Close it — the move landed anyway.',
      },
      {
        kind: 'check',
        text: 'Reopen the event and walk its tabs: Details, Attendance, Check-in/out, Next session, Materials',
      },
      {
        kind: 'submit',
        text: 'Cleanup: open the event and press Delete in the dialog footer — events have no confirm step',
        target: { button: 'Delete' },
        post: '/calendar',
      },
    ],
  },
  {
    id: 'daily-kiosk',
    journey: 'daily',
    title: 'Run the check-in kiosk for a session',
    tag: 'caution',
    route: '/checkin',
    account: 'staff',
    specs: ['crud-kiosk.spec.ts', 'crud-checkin-special.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open the kiosk screen', route: '/checkin' },
      {
        kind: 'check',
        text: 'CAUTION — this writes real attendance. Open a real upcoming session from the calendar, go to its Check-in/out tab, and press "Open check-in kiosk".',
      },
      {
        kind: 'check',
        text: 'Tap in AS THE TEST STUDENT ONLY (Leo Park / vunq@mochi.edu). Every other tile is somebody’s actual child.',
      },
      {
        kind: 'check',
        text: 'Press Close kiosk, then the event dialog’s Attendance tab — the test student now reads Present',
      },
      {
        kind: 'check',
        text: 'Cleanup: put the test student back on the attendance state you found them in, on that same tab',
      },
    ],
  },
  {
    id: 'daily-attendance',
    journey: 'daily',
    title: 'Take attendance on an event',
    tag: 'caution',
    route: '/calendar',
    account: 'staff',
    specs: ['crud-event-tabs.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Calendar', route: '/calendar' },
      {
        kind: 'check',
        text: 'CAUTION — real attendance rows. Open a real event and switch to its Attendance tab.',
      },
      {
        kind: 'check',
        text: 'On the test student’s row only, click Present → Absent → Present. Do NOT press "Mark all present" — it writes the entire roster in one go.',
      },
      { kind: 'check', text: 'Reload the page and reopen the tab: the final state stuck' },
      { kind: 'check', text: 'Cleanup: leave the test student on the state you found them in' },
    ],
  },
  {
    id: 'daily-scores',
    journey: 'daily',
    title: 'Record a score, a behavior mark and a remark',
    tag: 'caution',
    route: '/assessments',
    account: 'staff',
    specs: ['crud-assess.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Assessments', route: '/assessments' },
      {
        kind: 'check',
        text: 'CAUTION — real grades. Press Add score and record one, for the test student only.',
      },
      {
        kind: 'check',
        text: 'Attitude & behavior tab → Log behavior, again for the test student only',
      },
      {
        kind: 'check',
        text: 'Monthly report tab → set the star ratings on the test student’s card and press Save report',
      },
      { kind: 'check', text: 'Reload — all three entries persist' },
      {
        kind: 'check',
        text: 'Cleanup: delete the score, the behavior entry and the monthly report (Delete, then Confirm on each). Do not touch the seeded assessment types or remark criteria themselves.',
      },
    ],
  },
  {
    id: 'daily-checkin-author',
    journey: 'daily',
    title: 'Author a check-in activity and use it on a session',
    tag: 'write',
    route: '/config',
    account: 'staff',
    specs: ['crud-checkin-author.spec.ts', 'crud-checkin-special.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Config', route: '/config' },
      { kind: 'check', text: 'Open the Check-in activities row' },
      {
        kind: 'click',
        text: 'Click Add activity',
        target: { button: 'Add activity' },
        opensDialog: 'Add activity',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder activity name',
        dialog: 'Add activity',
        fields: [{ field: 'Activity name', value: 'WALKTHROUGH square' }],
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/config' },
      {
        kind: 'check',
        text: 'Open a recurring class event → Check-in/out tab → Add item, and choose WALKTHROUGH square as that row’s activity. A recurring event also renders the "check-in buổi sau" section for the next occurrence, and the special squares (homework, check-out) sit in the same tab.',
      },
      {
        kind: 'check',
        text: 'Cleanup: delete the check-in item you added, then delete WALKTHROUGH square from the Check-in activities row on Config',
      },
    ],
  },

  // ---------------------------------------------------------------- monthly (staff)
  {
    id: 'month-tuition',
    journey: 'monthly',
    title: 'Review the month’s tuition and send a slip',
    tag: 'caution',
    route: '/tuition',
    account: 'staff',
    specs: ['crud-tuition.spec.ts', 'crud-tui-mu.spec.ts', 'crud-zalo.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Tuition', route: '/tuition' },
      {
        kind: 'check',
        text: 'Read the current month across the table: sessions, price, total due, paid, outstanding',
      },
      {
        kind: 'check',
        text: 'Open Class prices to see where a month’s price comes from — a price takes effect on the 1st of the month it is set for, and is frozen once the month closes',
      },
      {
        kind: 'check',
        text: 'On the test student’s row press Fee slip, copy the slip image to the clipboard, and paste it somewhere to confirm it rendered',
      },
      {
        kind: 'check',
        text: '**DO NOT press Close month.** Closing freezes every amount for the whole school for that month, and Reopen month is an audited undo rather than a no-op. Record payment and Adjustment are just as real — on this screen, read only.',
      },
    ],
  },
  {
    id: 'month-rank',
    journey: 'monthly',
    title: 'Read last month’s rankings',
    tag: 'read',
    route: '/rankings',
    account: 'staff',
    specs: ['crud-rankings.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Rankings', route: '/rankings' },
      {
        kind: 'check',
        text: 'Switch to last month. The month lives in the path (/rankings/2026-07), so the view you are looking at is linkable.',
      },
      { kind: 'check', text: 'Use the Classes tab to move between classes' },
      {
        kind: 'check',
        text: 'Spot-check one student against their assessment entries: the total is attitude and average score weighted by the Ranking weights setting, and a component with no data for the month is excluded from the mean rather than counted as zero (shared/logic/rankings.ts)',
      },
    ],
  },
  {
    id: 'month-report',
    journey: 'monthly',
    title: 'Open the printable monthly report',
    tag: 'read',
    route: '/assessments',
    account: 'staff',
    specs: ['crud-garden3.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Assessments', route: '/assessments' },
      {
        kind: 'check',
        text: 'Monthly report tab → open the test student’s printable report (/assessments/<month>/<studentId>/report). It is a standalone document route, with no app shell.',
      },
      {
        kind: 'check',
        text: 'The garden section renders inside it. That data arrives through /garden-month, the cookie-authed twin of /api/garden/month — /api/* is bearer-only, so the report cannot call it directly (memory: api-routes-are-bearer-only).',
      },
      { kind: 'check', text: 'Print preview holds a single A4 page' },
    ],
  },

  // ---------------------------------------------------------------- content (staff)
  {
    id: 'content-vocab',
    journey: 'content',
    title: 'Build a vocabulary set and give it pictures',
    tag: 'write',
    route: '/vocabulary',
    account: 'staff',
    specs: [
      'crud-vocab-library.spec.ts',
      'crud-vocab-curriculum.spec.ts',
      'crud-vocab-images.spec.ts',
    ],
    steps: [
      { kind: 'goto', text: 'Open Vocabulary', route: '/vocabulary' },
      {
        kind: 'click',
        text: 'Click New topic',
        target: { button: 'New topic' },
        opensDialog: 'New topic',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder topic name',
        dialog: 'New topic',
        fields: [{ field: 'Topic name', value: 'WALKTHROUGH animals' }],
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/vocabulary' },
      {
        kind: 'check',
        text: 'Open the deck by clicking its TITLE (the card centre is occupied by the staff action buttons), then press Add word three times, filling Word and Meaning (Vietnamese)',
      },
      { kind: 'check', text: 'Attach the deck to a curriculum week' },
      {
        kind: 'check',
        text: 'Give one word a picture from the Openverse strip — searching and "Show different pictures" are free. **AI image generation bills a real Workers AI account per image. Do not press it.**',
      },
      {
        kind: 'check',
        text: 'Cleanup: detach the deck from the curriculum week, then delete WALKTHROUGH animals from the topics grid (Delete, then confirm)',
      },
    ],
  },
  {
    id: 'content-test',
    journey: 'content',
    title: 'Write questions, build a test, assign it',
    tag: 'write',
    route: '/questions',
    account: 'staff',
    specs: ['crud-questions2.spec.ts', 'crud-tests.spec.ts', 'crud-tests3.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open the question bank', route: '/questions' },
      {
        kind: 'click',
        text: 'Click New question',
        target: { button: 'New question' },
        opensDialog: 'New question',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder prompt',
        dialog: 'New question',
        fields: [{ field: 'Question', value: 'WALKTHROUGH question one' }],
      },
      {
        kind: 'check',
        text: 'Press Add option twice, fill Option 1 and Option 2, and tick one of them as the correct answer',
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/questions' },
      { kind: 'goto', text: 'Open Tests', route: '/tests' },
      {
        kind: 'click',
        text: 'Click New test',
        target: { button: 'New test' },
        opensDialog: 'New test',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder test name',
        dialog: 'New test',
        fields: [{ field: 'Test name', value: 'WALKTHROUGH test' }],
      },
      {
        kind: 'submit',
        text: 'Press Save — a successful create navigates straight to the new test’s detail page',
        target: { button: 'Save' },
        post: '/tests',
      },
      {
        kind: 'check',
        text: 'Questions tab → press Add on WALKTHROUGH question one, then Save questions. "Import from file" takes a CSV instead, but a file picker cannot be pre-filled by the tour.',
      },
      {
        kind: 'check',
        text: 'Setup tab → pick a Class and a Delivery, then Publish. That is what assigns it to the class, the test student included.',
      },
      {
        kind: 'check',
        text: 'Open the print view at /tests/<id>/print — another standalone document route',
      },
      {
        kind: 'check',
        text: 'Cleanup: press Back to draft, delete the test (Delete, then Delete), then delete WALKTHROUGH question one from the question bank',
      },
    ],
  },
  {
    id: 'content-materials',
    journey: 'content',
    title: 'Add a material and attach it to a class and a session',
    tag: 'write',
    route: '/materials',
    account: 'staff',
    specs: ['crud-materials.spec.ts', 'crud-class-materials.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Materials', route: '/materials' },
      {
        kind: 'click',
        text: 'Click Add material',
        target: { button: 'Add material' },
        opensDialog: 'Add material',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder title',
        dialog: 'Add material',
        fields: [{ field: 'Title', value: 'WALKTHROUGH.pdf' }],
      },
      {
        kind: 'check',
        text: 'Choose the file yourself — a file picker cannot be pre-filled by the tour. (Setting Type to Link swaps the drop zone for a URL field, if you would rather not upload anything.)',
      },
      { kind: 'submit', text: 'Press Save', target: { button: 'Save' }, post: '/materials' },
      {
        kind: 'check',
        text: 'The library is CRUD-only: attaching happens elsewhere. Open a class and use its Add material, then do the same on an event dialog’s Materials tab.',
      },
      { kind: 'check', text: 'The card’s Download link (or Open link, for a URL material) works' },
      {
        kind: 'check',
        text: 'Cleanup: detach it from the class and the event, then delete it from Materials — materials delete has no confirm, and deleting also removes the R2 object',
      },
    ],
  },
  {
    id: 'content-pronounce',
    journey: 'content',
    title: 'Hear a word and score one pronunciation attempt',
    tag: 'caution',
    route: '/vocabulary',
    account: 'staff',
    specs: ['crud-pronounce.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Vocabulary', route: '/vocabulary' },
      {
        kind: 'check',
        text: 'Open a deck, start the pronunciation game and press Say it — playback costs nothing',
      },
      {
        kind: 'check',
        text: 'CAUTION — **one** recorded attempt, no more. "Tap the mic and say the word" posts to Azure Speech; its F0 tier has a monthly cap per SUBSCRIPTION (not per school), and going past it is a real charge.',
      },
      {
        kind: 'check',
        text: 'Read the score, open Detailed breakdown to see per-syllable scores and what the service heard, press Close, then Exit the round',
      },
    ],
  },

  // ---------------------------------------------------------------- admin (staff)
  {
    id: 'admin-logs',
    journey: 'admin',
    title: 'Read the logs: notifications, activity, usage',
    tag: 'read',
    route: '/logs/notifications',
    account: 'staff',
    specs: ['logs.spec.ts', 'logs-notifications.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Logs → Notifications', route: '/logs/notifications' },
      { kind: 'check', text: 'Recent sends render with per-recipient status' },
      {
        kind: 'check',
        text: 'The Delivery status card at the top carries the four notification switches — Class reminders, Evening previews, Study nudges, Garden alerts — alongside which channels can deliver at all. They are READ-ONLY here: "These switches live in notification preferences, which only the phone app can edit today." A job card sitting empty under "Turned off" is this panel explaining itself.',
      },
      { kind: 'check', text: 'Open Activity — your walkthrough writes from earlier appear here' },
    ],
  },
  {
    id: 'admin-feedback',
    journey: 'admin',
    title: 'File feedback and move it across the board',
    tag: 'write',
    route: '/feedback',
    account: 'staff',
    specs: ['crud-feedback-profile.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Feedback', route: '/feedback' },
      {
        kind: 'click',
        text: 'Click Log feedback',
        target: { button: 'Log feedback' },
        opensDialog: 'Share feedback',
      },
      {
        kind: 'fill',
        text: 'Form pre-filled with a placeholder message',
        dialog: 'Share feedback',
        fields: [{ field: 'Your feedback', value: 'WALKTHROUGH ignore me' }],
      },
      {
        kind: 'submit',
        text: 'Press Send feedback',
        target: { button: 'Send feedback' },
        post: '/feedback',
      },
      {
        kind: 'check',
        text: 'The card lands in New with an F-nn handle to quote. Move it along the five columns — New, Reviewed, On hold, Backlog, Resolved — by dragging it, or by clicking the card’s message to open the editor and changing Status there. There is no resolve button.',
      },
      {
        kind: 'submit',
        text: 'Cleanup: press Delete on the card — feedback delete has no confirm',
        target: { button: 'Delete' },
        post: '/feedback',
      },
    ],
  },
  {
    id: 'admin-settings',
    journey: 'admin',
    title: 'Update my profile details',
    tag: 'write',
    route: '/profile',
    account: 'staff',
    specs: [],
    steps: [
      { kind: 'goto', text: 'Open your profile', route: '/profile' },
      {
        kind: 'check',
        text: 'Note what Phone currently holds under Personal details, then type a new number into it. (Deliberately NOT a notification toggle: the four notification switches are read-only on the web, and are shown at Logs → Notifications — see admin-logs. The calendar’s Customize drawer, theme and default view, is the other per-account setting, and it belongs to the calendar rather than to this screen.)',
      },
      {
        kind: 'submit',
        text: 'Press Save changes',
        target: { button: 'Save changes' },
        post: '/profile',
      },
      {
        kind: 'check',
        text: 'Reload the page. The "Saved ✓" flip is optimistic, so only a reload proves the value was written.',
      },
      {
        kind: 'check',
        text: 'Cleanup: put Phone back to the value you noted at the start (blank, on the seeded staff account) and press Save changes again',
      },
    ],
  },
  {
    id: 'admin-live',
    journey: 'admin',
    title: 'Watch a second tab update without a reload',
    tag: 'read',
    route: '/dashboard',
    account: 'staff',
    specs: ['live-updates.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open the dashboard', route: '/dashboard' },
      {
        kind: 'check',
        text: 'Open the calendar in two tabs, both signed in as the same staff account',
      },
      { kind: 'check', text: 'In tab A, create and then delete an event named WALKTHROUGH live' },
      {
        kind: 'check',
        text: 'Tab B follows both writes without a reload: the LiveHub Durable Object pushes an invalidate over /ws to every open tab (memory: live-updates-websocket-hub)',
      },
    ],
  },

  // ---------------------------------------------------------------- student
  {
    id: 'stu-dash',
    journey: 'student',
    title: 'The student dashboard',
    tag: 'read',
    route: '/dashboard',
    account: 'student',
    specs: [],
    steps: [
      {
        kind: 'goto',
        text: 'Sign in as the test student (vunq@mochi.edu) and open the dashboard',
        route: '/dashboard',
      },
      { kind: 'check', text: 'Today’s sessions, the review streak and pending work all render' },
      {
        kind: 'check',
        text: 'No staff navigation is visible: the rail offers only the learning section — Vocabulary, Garden, My tests, My schedule',
      },
    ],
  },
  {
    id: 'stu-review',
    journey: 'student',
    title: 'Review this week’s vocabulary',
    tag: 'write',
    route: '/vocabulary',
    account: 'student',
    specs: ['crud-review.spec.ts'],
    steps: [
      {
        kind: 'goto',
        text: 'Open Vocabulary as the test student (the old /flashcards URL 301-redirects here)',
        route: '/vocabulary',
      },
      { kind: 'check', text: 'Open the current week’s deck, or one the grid marks Review now' },
      { kind: 'check', text: 'Press Flip cards, answer a short round with "I know it", then Exit' },
      {
        kind: 'check',
        text: 'The dashboard’s review progress moves. This writes real progress rows and there is no delete affordance — that is fine on production, because vunq@mochi.edu is the designated test student.',
      },
    ],
  },
  {
    id: 'stu-pvp',
    journey: 'student',
    title: 'Play a vocabulary face-off',
    tag: 'write',
    route: '/game-rooms',
    account: 'student',
    specs: ['pvp.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open the game rooms screen', route: '/game-rooms' },
      {
        kind: 'check',
        text: 'From a deck press Battle → Room with friends → Create room, and copy the room code',
      },
      { kind: 'check', text: 'Join from a second browser with that code, then press Start' },
      {
        kind: 'check',
        text: 'Play through to a result. The room and its result rows belong to the test student and have no delete affordance, so there is nothing to clean up.',
      },
    ],
  },
  {
    id: 'stu-garden',
    journey: 'student',
    title: 'Watch the class garden grow',
    tag: 'write',
    route: '/garden',
    account: 'student',
    specs: ['crud-garden.spec.ts', 'crud-garden2.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open the garden', route: '/garden' },
      {
        kind: 'check',
        text: 'The class garden reflects check-ins — plants advance with sessions attended',
      },
      { kind: 'check', text: 'Open a mystery bag (túi mù) if the class has earned one' },
      { kind: 'check', text: 'Open the album for a past month at /garden/<classId>/album/<month>' },
      {
        kind: 'check',
        text: 'Garden progress is real data for the test student with no delete affordance — nothing to undo here',
      },
    ],
  },
  {
    id: 'stu-test',
    journey: 'student',
    title: 'Sit an assigned online test',
    tag: 'write',
    route: '/my-tests',
    account: 'student',
    specs: ['crud-tests3.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open My tests as the test student', route: '/my-tests' },
      {
        kind: 'check',
        text: 'Pairs with content-test: the WALKTHROUGH test has to be published to this student’s class first, with Delivery set to Online',
      },
      {
        kind: 'check',
        text: 'Press Start on the card to open it, then Start again on the detail page — that second press is what begins the attempt',
      },
      {
        kind: 'check',
        text: 'Answer, wait for the "Saved ✓" autosave, press Submit and confirm. The card flips to "Awaiting grading".',
      },
      {
        kind: 'check',
        text: 'As staff, the test’s Results tab shows the submission needing grading. Deleting the test in content-test’s cleanup takes the attempt with it.',
      },
    ],
  },
  {
    id: 'stu-rank',
    journey: 'student',
    title: 'The student’s view of the rankings',
    tag: 'read',
    route: '/rankings',
    account: 'student',
    specs: ['crud-rankings.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open Rankings as the test student', route: '/rankings' },
      { kind: 'check', text: 'The board is scoped to the classes this student is actually in' },
      {
        kind: 'check',
        text: 'None of the staff controls are reachable — no class management, no weight editing',
      },
    ],
  },

  // ---------------------------------------------------------------- parent
  {
    id: 'par-portal',
    journey: 'parent',
    title: 'The parent portal, end to end',
    tag: 'read',
    route: '/children',
    account: 'parent',
    specs: ['parent-portal.spec.ts'],
    steps: [
      { kind: 'goto', text: 'Open My children', route: '/children' },
      {
        kind: 'check',
        text: 'There is no seeded parent login. Mint one: as staff, People → Add student with a parent name filled in (or Add parent on the Parents tab), take the parent code out of "Invite codes ready", and redeem it on the sign-in screen via "I have an invite code". Then turn the portal on in Config — both the nav row and the /children path are gated on that toggle. Memory: four-role-test-accounts.',
      },
      { kind: 'check', text: 'The Children overview lists each child with an Open link' },
      {
        kind: 'check',
        text: 'A child’s month view carries attendance, scores, remarks, the garden and tuition, with Report card and Fee slip buttons',
      },
      {
        kind: 'check',
        text: 'The portal’s queries have a 5-minute staleTime. A write you made as staff a moment ago may legitimately not be visible yet — wait it out rather than chasing a bug that is not there.',
      },
    ],
  },
];
