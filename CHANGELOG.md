# Changelog

One entry per push to `main`. Newest first. Add one with:
`node scripts/changelog.mjs "what changed"`

Version is `v{major}.{build}`. `major` lives in `shared/version.json`; the build number is
derived from the git commit count and is never stored.

## v0.0168 — 2026-08-11
CLAUDE.md: widen the manual-trigger test rule from the staging e2e suite to every test suite, including npm test, and name the fast static checks that are free to run.

## v0.0167 — 2026-08-11
Word editor is two columns: fields on the left, a 3x3 picture picker with a refresh button on the right. Dropped the picture hint line and the draw-with-AI button.
Word list is a grid of cards, each led by a big 4:3 picture with the speaker/edit/delete icons in a rail beside it, then the word + IPA, then the meaning.

## v0.0166 — 2026-08-11
Vocabulary topic: show the word list in two columns and enlarge each word's picture thumbnail.

## v0.0165 — 2026-08-11
Feedback board: each status column now scrolls its own card list inside a bounded page, so a long column no longer scrolls the whole page away from the other drop targets.

## v0.0161 — 2026-08-11
Vocabulary: 4 new game modes (Unscramble, Fill letters, Type it, Picture quiz) on web and mobile; assignments can now require specific modes

## v0.0160 — 2026-08-11
Pictures on vocabulary flashcards: words carry an R2-stored image picked from stock search or AI-drawn, shown on flip cards, word lists and a picture→word quiz variant

## v0.0159 — 2026-08-10
Ôn tập: words a student has studied come back for review after 3, 5, 7, 14, 30 days — a due card and sidebar badge on /vocabulary, a review deck behind ?review=1, and an admin-tunable interval ladder. Answering right at the due date stretches the gap, wrong shortens it; nothing is swept and no notification is sent. Monthly report v2: remarks now record their author and when the slip last reached a family, the report gains attendance, per-class scores and vocabulary homework, and the roster shows what has been sent. Parents get a portal — a Children tab on web and phone, dark until an admin switches it on.

## v0.0158 — 2026-08-10
docs(plans): add monthly-report-v2 plan — attendance, per-class scores, vocab homework, author/sent tracking, roster

## v0.0156 — 2026-08-10
Invite codes are minted when a person is added and tied to them, so redeeming attaches a login instead of creating a duplicate. Parents can sign in to a profile-only portal; the student form takes a real parent (new or an existing one for siblings) in place of the free-text guardian.

## v0.0155 — 2026-08-10
Tuition is staff-only again: the phone's Học phí screens, the /api/tuition/me endpoints and the fee-amount push notification are all removed. Families are told by the printed slip and the office, not by the app.

## v0.0154 — 2026-08-10
System config is now a list of rows grouped by area; each row shows its current value and opens into a modal. The five managed lists (types, criteria, khối, trình độ, môn học) collapse into one component. Profile page laid out in three columns.

## v0.0153 — 2026-08-10
Subject becomes a managed config list instead of free text, on web and phone.

## v0.0152 — 2026-08-10
Rankings month picker stops at the current month — future months could only ever be empty.

## v0.0151 — 2026-08-10
Classes gain khối + trình độ; rankings scope students to a cohort and add class-vs-class boards.

## v0.0147 — 2026-08-10
Documented the Zalo channel: docs/zalo.md covers pairing, the polling relay, config and the traps.

## v0.0146 — 2026-08-10
Report cards and next-session cards send to Zalo too — all four share cards now have the button.

## v0.0145 — 2026-08-10
Fee slips go to a parent record only — never to a chat that might be the student.

## v0.0144 — 2026-08-10
Fee slips send straight to the family's Zalo instead of copy-and-paste.

## v0.0143 — 2026-08-10
Send to Zalo works from the share cards: the upload endpoint was bearer-only and a browser has a cookie.

## v0.0142 — 2026-08-09
Zalo: pair a family by student, not just by parent record — most students have no parent row.

## v0.0141 — 2026-08-09
Zalo pairing works again: Cloudflare blocked Zalo's webhook agent, so a Durable Object long-polls instead.

## v0.0139 — 2026-08-08
Zalo: a bot token stored with stray whitespace made every send 404 — trimmed at the seam.

## v0.0137 — 2026-08-07
Monthly report tiles: icon-above-number dashboard layout in the wide three-column view.

## v0.0136 — 2026-08-07
Monthly report: the summary and garden tiles expand to fill their columns' height.

## v0.0135 — 2026-08-07
Monthly report's three columns run full height so their bottoms line up.

## v0.0134 — 2026-08-07
Monthly report is three columns on a wide screen: the remark narrows and the two summary cards sit side by side.

## v0.0133 — 2026-08-07
Monthly report fits without scrolling: compact rail tiles, and the remark card sizes to its content instead of stretching to the row.

## v0.0132 — 2026-08-07
Record the garden-card 401 and its fix in the handoff plan; note the browser verification is now done.

## v0.0131 — 2026-08-07
Fix the monthly-report garden card: it fetched a bearer-only /api route from the browser and 401'd on every call, so it never rendered. Added a cookie-authed /garden-month twin.

## v0.0130 — 2026-08-07
Document the garden-on-monthly-report session as a handoff plan in docs/plans, and record the mobile report tab as a known parity gap.

## v0.0129 — 2026-08-07
Add the vocabulary-garden month summary to the assessments monthly report: a six-tile rail card (days practised, rounds passed, stages grown, fruit, all-time fruit, stages lost) plus the plant as it stands, and two parent-facing garden tiles on the printed slip.

## v0.0128 — 2026-08-07
Sidebar categories no longer restore their cached expansion: every page load starts all-collapsed and expands only the section owning the current route.

## v0.0127 — 2026-08-07
CI now typechecks the phone app on every push (it never did), and the stale-route-types trap that made mobile typecheck permanently red is written down.

## v0.0126 — 2026-08-07
Cap nhat ung dung dien thoai xong ngay trong lan mo dau tien: khong con phai mo app, tat di roi mo lai moi thay ban moi.

## v0.0125 — 2026-08-07
Vườn cây từ vựng trên điện thoại: học sinh xem cây của mình ngay trên trang từ vựng, biết ngay mỗi lượt học có làm cây lớn hay không, thu hoạch quả, đặt tên và chọn màu chậu, xem vườn lớp cùng cây tập thể và album các tháng đã lưu. Giáo viên vẫn chăm vườn trên web.

## v0.0124 — 2026-08-07
Add a root BACKLOG.md: one ranked list of what is left to build, replacing open items scattered across four unrelated docs. Records the garden as web-only, which no doc had captured.

## v0.0123 — 2026-08-07
Fix a shebang in the question-csv skill validator that made vitest drop 24 tests at import and blocked the worker suite behind it. The staging e2e suite is now manual-trigger only.

## v0.0120 — 2026-08-07
Vocabulary topic cards: move the staff action buttons onto their own row below the topic name, so short names no longer truncate at the 240px card minimum. Fix three e2e specs that navigated by center-clicking the card, which after the reflow landed on the Assign button.

## v0.0119 — 2026-08-07
Sidebar sections are now prominent headings with their own icons, default to collapsed, and the sidebar keeps a 2px hairline scrollbar.

## v0.0118 — 2026-08-07
Sidebar nav regrouped from one 12-item Manage list into five collapsible sections (Overview / Teaching / Grading / Learning / Admin), with per-device collapse state, badge roll-up onto collapsed headers, and auto-expand of the active section.

## v0.0117 — 2026-08-07
Cong cu thu nghiem vuon cay cho admin: dat cay ve bat ky giai doan nao va gia lap so ngay bo be, nen xem duoc ngay trang thai heo va chet ma khong phai cho vai ngay.

## v0.0116 — 2026-08-06
Vườn cây từ vựng: giáo viên giao bài từ vựng theo lớp kèm hạn nộp; mỗi học sinh có một cây lớn theo lượt học đạt điểm, héo và tụt bậc khi bỏ bê, ra quả thì thu hoạch. Thêm vườn lớp dùng chung, cây tập thể của lớp, giáo viên tưới nước khen thưởng, album vườn theo tháng và ảnh chia sẻ Zalo.

## v0.0115 — 2026-08-06
Project instructions: every new feature/data object must ship with an e2e spec; test-env workflow and reset-sweep rules documented.

## v0.0114 — 2026-08-06
Fix dropdowns dismissing themselves when opened while a filled input has focus (blur scroll-reset); e2e suite now covers every CRUD variant end to end.

## v0.0109 — 2026-08-06
Rankings: swap the month stepper for a dropdown, narrow the filter selects and centre the weights note against them.

## v0.0108 — 2026-08-06
Add monthly student rankings page (bảng xếp hạng): combined leaderboard by ý thức and test average, with class and month filters and configurable weights.

## v0.0107 — 2026-08-06
Monthly report: the month summary moves to the right of the remark form and fills the row height.

## v0.0106 — 2026-08-06
Assessments: filter controls on one row, monthly report tab split into a stats rail beside the remark form, and empty states fill their column instead of sitting as stubs.

## v0.0105 — 2026-08-06
Score progress chart sizes to its card instead of to an aspect ratio, so a wide window no longer makes it overflow the card and eat the page's bottom gutter.

## v0.0104 — 2026-08-06
Assessments scores tab: chart and test list side by side, list scrolls in place so the tab fits one screen. ProgressLineChart takes a viewBox width and no longer clips its end date labels.

## v0.0103 — 2026-08-06
Fix CI: exclude the Remotion video/ workspace from the root typecheck — it had been failing every push (blocking deploys and D1 migrations) since the video catalog landed

## v0.0102 — 2026-08-06
Monthly remark criteria are now system-configurable: manage (add/rename/reorder/retire) the rating rows in System configuration; remark ratings stored per-criterion

## v0.0101 — 2026-08-06
fix: 'All time' button now bottom-aligns with the month select in assessments filters

## v0.0100 — 2026-08-06
Tuition billable-status checkboxes now use the DS mochi Checkbox

## v0.0099 — 2026-08-05
Add the Remotion video catalog under video/: Playwright records the live app, a Remotion composition wraps it in Mochi brand with Vietnamese captions. First guide: calendar-basics.

## v0.0098 — 2026-08-05
Assessments: month filter is a labelled dropdown of recorded months, with a separate All-time reset button

## v0.0097 — 2026-08-05
Feedback is a kanban board: New / Reviewed / Resolved columns with drag-and-drop between them, and the changelog moves out of a tab into a modal opened from the page header.

## v0.0096 — 2026-08-05
Preview buổi sau: per-occurrence lesson preview for students, parents (Zalo card) and teachers, with an evening push. Plus monthly remarks (nhận xét tháng) from a parallel session.

## v0.0095 — 2026-08-05
Scores follow one colour convention everywhere: red under 5, orange 5-7, green 7 and up. The progress chart's dots and each line segment take the colour of the score they land on.

## v0.0094 — 2026-08-05
Feedback stamps carry the time of day, localised and shared by web and mobile. The server is now the sole author of createdAt, and a migration gives the old time-less rows a time.

## v0.0093 — 2026-08-05
Feedback inbox shows the time of day, not just the date. The server now stamps createdAt with a full ISO timestamp for both web and mobile submissions.

## v0.0092 — 2026-08-04
Minimal slip: keep the serif title. The design system styles every h1 globally, which was overriding it with the display font.

## v0.0091 — 2026-08-04
New Minimal fee-slip style, copied from the centre's typed receipts: a Buoi hoc / Ngay hoc table of every session date, the per-session price, and the total spelled out in Vietnamese words.

## v0.0090 — 2026-08-04
Fee slip fixes found by screenshotting it: the Classic layout's month line no longer inherits the calendar's grid, the bow doodle draws correctly, and the month reads as a name instead of 2031-03.

## v0.0089 — 2026-08-04
Fee slip is now a themed image you copy to the clipboard for Zalo instead of a print document: new Cute pastel style (default) plus Classic, an SDT line from the parent's phone, and no more signature or provisional lines.

## v0.0088 — 2026-08-04
Tuition: clearing the payment date no longer fails the whole payment save with a 400.

## v0.0087 — 2026-08-04
Tuition: an all-zero payment row no longer lists a student as paid on a month where nothing was billed, which also makes zeroing a payment work as an undo.

## v0.0086 — 2026-08-04
Tuition (học phí) module: per-session class prices with effective dates, monthly fees computed from attendance, payment and adjustment tracking, explicit month close that freezes amounts, and a printable phiếu thu. Admin-only.

## v0.0085 — 2026-08-03
Regenerate worker-configuration.d.ts from wrangler; secrets now declared in globals.d.ts so regeneration cannot silently drop them.

## v0.0084 — 2026-08-03
Attendance is now live: useCachedLoad does stale-while-revalidate, so a roster marked by one teacher appears in another open event modal.

## v0.0083 — 2026-08-02
Stabilise the live-update e2e specs: wait out the gap between the socket request and the hub accepting it.

## v0.0082 — 2026-08-02
Fix live sidebar badges: the layout-refresh flag cleared itself on read, but React Router asks shouldRevalidate several times per revalidation and acts on the last answer, so it never refetched. Adds e2e coverage against the deployment.

## v0.0081 — 2026-08-02
Live updates: a LiveHub Durable Object broadcasts mutation domains over WebSocket, so open tabs refresh their data and sidebar badges without a reload. Mobile API writes notify web clients too.

## v0.0079 — 2026-08-02
Question bank gets multi-select with bulk actions (set grade level, set difficulty, add a tag, delete selected) and a Wipe bank danger button. Bulk delete keeps questions a test still uses and says how many; the wipe detaches every test and warns that students' stored answers go with it.

## v0.0078 — 2026-08-02
Question import now reads a CSV you prepare yourself instead of calling Claude to read the paper. A new question-csv skill turns a test paper (and its separate answer key) into that CSV in a chat, the app parses it in the browser for free, and the AI extraction endpoint is gone.

## v0.0074 — 2026-08-01
Question import v2: reading passages and section instructions are kept as a new per-question passage field, the model returns questions grouped with their printed numbers, a separate answer key can be pasted or uploaded on the review screen, and underlines survive Word import.

## v0.0073 — 2026-08-01
Clicking the Mochi logo in the sidebar now navigates home — /dashboard for staff, /vocabulary for students.

## v0.0072 — 2026-08-01
Remove the first-visit instructions modal and the sidebar help button that reopened it, along with its i18n strings, styles and test scaffolding.

## v0.0070 — 2026-07-31
Import questions from a file: upload a Word, PDF, Excel or Markdown test paper and Claude reads the questions out for review before they are saved to the bank (or straight onto a test). Also fixes a D1 bound-parameter limit that broke saving a test with more than 25 questions.

## v0.0069 — 2026-07-31
Date picker popover now sizes to its 44px day grid instead of a stale 272px width, so the calendar no longer overflows the panel.

## v0.0068 — 2026-07-31
Fix the long-failing class_schedule cascade test; worker suite fully green

## v0.0067 — 2026-07-31
Fix test date/mode propagation, surface skipped paper scores, drop dead i18n keys

## v0.0066 — 2026-07-31
Online tests: students take them in-app with a timer; teachers grade essays and reset attempts

## v0.0065 — 2026-07-31
Remove homework; the Tests module replaces it

## v0.0064 — 2026-07-31
Attempts service: start, autosave, submit with auto-grading, essay grading, reset

## v0.0063 — 2026-07-31
Tests: builder, paper scoring that syncs to the gradebook, printable test + answer key

## v0.0062 — 2026-07-31
Tests module phase 1: question bank + managed grade levels

## v0.0061 — 2026-07-31
Replace the dictionaryapi.dev lookup with AI enrichment (meaning, IPA and definition) on web and mobile, in bulk import and the single-word editor. Wipe the stored pronunciation-audio URLs: every word is now spoken by the device's text-to-speech.

## v0.0060 — 2026-07-31
Remove the in-topic 'Generate with AI' button on web and mobile — AI generation now happens only when creating a whole topic from the vocabulary list.

## v0.0059 — 2026-07-31
Register the generate-topic API route so mobile AI topic creation works.

## v0.0058 — 2026-07-31
Vocabulary pages move from /flashcards to /vocabulary (old links redirect). Staff can generate a whole new topic with AI from the Vocabulary tab, and generated words now come with IPA pronunciation.

## v0.0057 — 2026-07-31
Rename the Flashcards tab to Vocabulary. Staff can now generate a vocab set for a topic with AI: pick a curated topic (or type your own), choose count and level, review the proposed words, then add the ones you keep.

## v0.0056 — 2026-07-30
Exit confirmation is now the app's own dialog - rounded card with brand buttons - instead of the plain system popup.

## v0.0055 — 2026-07-30
Pressing back on one of the main tabs now asks 'Exit Mochi?' before leaving the app, instead of closing immediately.

## v0.0054 — 2026-07-30
Back on one of the main tabs now leaves the app instead of returning to the previously visited tab. Detail screens still go back to the screen that opened them.

## v0.0052 — 2026-07-30
Android back button now retraces the screens you actually visited instead of jumping to Dashboard from everywhere. Also stops a student's back press from opening the staff dashboard.

## v0.0049 — 2026-07-29
Materials tab in the event modal now labels each material with its type; tsconfig pins noEmit so a bare tsc can never emit stray .js beside the sources; silence a bogus webhint typescript-config rule

## v0.0048 — 2026-07-29
Fix the sidebar badge freezing after a mutation: swrLoad's cache fill notified subscribers, which cancelled React Router's in-flight layout revalidation and discarded the fresh badge counts

## v0.0047 — 2026-07-29
Feedback page: centre the status badge with the row actions, drop the All tab (defaults to New), sidebar badge now counts unresolved (new + reviewed) so resolving anything updates it, and add a Changelog tab sourced from CHANGELOG.md at build time

## v0.0046 — 2026-07-29
Document the push-equals-publish invariant: EAS workflow auto-publishes OTA on main pushes, with post-push verification steps in CLAUDE.md

## v0.0043 — 2026-07-29
Mobile tab bar: no haptic on tab press; the soft-pill variant is now an outlined ring in the icon's colour instead of a filled lozenge.

## v0.0040 — 2026-07-28
Verify the navigation-latency work in a real browser: the e2e suite now passes against production and covers the offline retry-storm guard and scoped cache invalidation

## v0.0039 — 2026-07-28
Add a Playwright suite for the navigation-latency behaviours: cache-hit navigations, hover prefetch, and the pending progress bar, run against a real deployment

## v0.0038 — 2026-07-28
Speed up navigation: SWR route cache, scoped invalidation, prefetch, pending indicators, single-query auth

## v0.0037 — 2026-07-28
Review and amend the navigation latency plan: fix an infinite SWR retry loop on failed background refreshes, couple homework and assessments cache invalidation in both directions, and correct the verified source citations

## v0.0036 — 2026-07-28
docs: add navigation latency improvement plan (SWR route cache, scoped invalidation, prefetch, pending UI, single-query auth)

## v0.0035 — 2026-07-28
Fix npm run update:preview, which could never succeed: scope the OTA export to Android (the web export fails on expo-sqlite's wasm import) and pass the environment that non-interactive mode requires.

## v0.0034 — 2026-07-28
Fix the More screen rendering as an unstyled vertical stack: Link asChild routes through Radix Slot, which destroys a Pressable's function-form style prop.

## v0.0033 — 2026-07-28
Branded bottom tab bar for the mobile app with three admin-selectable styles (soft pill, floating dock, top indicator), and a fix for the tab bar being drawn underneath Android's navigation buttons.

## v0.0031 — 2026-07-28
Correct check 3: signing in does not register a push token, because the permission prompt is deliberately deferred to More - Notifications.

## v0.0030 — 2026-07-28
Stop the login page revealing a live invite code: the loader now returns only whether an unused code exists, and the hint shows a mask.

## v0.0029 — 2026-07-28
Fix invite codes arriving already spent: form booleans posted as the string 'false' were coerced to true. Same fix un-breaks turning off homework done, material favorite, assessment-type active and notification prefs.

## v0.0028 — 2026-07-28
Record that sent: 1 counts messages handed to Expo rather than accepted tickets, so it cannot prove delivery, and map each FCM credential to the check that actually proves it.

## v0.0027 — 2026-07-28
Build 5 carries both fixes: an aapt2-based APK verifier in mobile/scripts proves the update URL, runtimeVersion 2, the preview channel and the Firebase resources are all compiled in.

## v0.0026 — 2026-07-28
Record that the dev build and the preview APK cannot coexist on one device, and that OTA verification must therefore come before installing the dev build.

## v0.0025 — 2026-07-28
Document the two ordering traps in push verification: the 30-minute lead window, and a ledger key consumed by firing a job before any device has registered.

## v0.0024 — 2026-07-28
Compile the Firebase config into the app: googleServicesFile wired up, so FirebaseApp can initialise and push tokens can be issued.

## v0.0023 — 2026-07-28
Document the Google Cloud API-restriction trap for FCM keys, and record in mobile/.gitignore why google-services.json must stay committed.

## v0.0022 — 2026-07-28
Re-check phase 7's Android prerequisites against the machine: Studio and the SDK are installed, the emulator image and AVD are not, and ANDROID_HOME is unset.

## v0.0021 — 2026-07-28
Give the mobile app an EAS Update endpoint to check, and bump runtimeVersion to 2 for it. Verified absent from the shipped APK's manifest, so every published OTA had been a silent no-op.

## v0.0014 — 2026-07-28
Fix the version stamp always showing v0.0000: Workers Builds is the sole deployer now and its shallow clone is deepened before the build number is derived.

## v0.0010 — 2026-07-27
Mobile phase 4: staff core on the phone — dashboard with a two-tap attendance shortcut, agenda-first calendar with month and day views, long-press reschedule, full-screen event detail with attendance/homework/materials tabs, class schedule and roster editors, and homework grading.

## v0.0009 — 2026-07-27
Pre-flight for phase 4: install react-native-webview and the native date/time picker before the first APK, so no later native addition forces a runtimeVersion bump and a reinstall.

## v0.0008 — 2026-07-27
Mobile flashcards: all three games (flip rebuilt on Reanimated gestures), offline topic downloads, and an idempotent outbox so a game finished with no signal syncs exactly once. /api/flashcards/topic/:slug now returns results too, so students see the leaderboard on the phone as they do in the browser.

## v0.0007 — 2026-07-27
Point the mobile app at the live Worker (https://calendar.ngqv0712.workers.dev) — the same origin as the web app, since /api/* are resource routes in the same Worker.

## v0.0006 — 2026-07-27
Add the Expo mobile app shell: bearer-token auth in secure storage, role-based bottom tabs, the design system as React Native primitives, vi-first i18n, and React Query mirroring the web's cache keys. Login, Profile, More and Language are real; the rest are labelled placeholders.

## v0.0005 — 2026-07-27
Fix CI version stamp: deploy workflow now checks out full history so the derived build number is not v0.0000.

## v0.0004 — 2026-07-27
Accept a JSON body on /translate so the mobile client can use it, alongside the FormData the web screen posts.

## v0.0003 — 2026-07-27
Add a JSON API at /api/* for the mobile app: bearer-token auth, ~30 resource routes over the existing service layer, and idempotent flashcard result recording.

## v0.0002 — 2026-07-27
Extract the i18n dictionary, color tokens, flip-gesture tuning, and recurrence/date logic into shared/ so the mobile app can import them. No behaviour change.

## v0.0001 — 2026-07-27
Introduce shared versioning: derived build number, changelog script, and a sidebar version stamp.
