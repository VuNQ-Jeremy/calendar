import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  // The public marketing site. Outside the _app layout, like /login and /signup: an
  // unauthenticated visitor must see it instead of being bounced to /login. The layout
  // owns the shared shell (header/nav/footer); home.tsx's loader decides landing-vs-app
  // per host once APP_ORIGIN exists (server/origin.ts).
  layout('routes/landing.tsx', [
    index('routes/home.tsx'),
    route('features', 'routes/landing.features.tsx'),
    route('pricing', 'routes/landing.pricing.tsx'),
    route('about', 'routes/landing.about.tsx'),
    route('guides', 'routes/landing.guides.tsx'),
  ]),
  route('login', 'routes/login.tsx'),
  route('verify-email', 'routes/verify-email.tsx'),
  // Sign in with Google (web only). Both outside `_app`, like /login — no session yet on the
  // way in, and the callback needs to mint the cookie before any app-shell loader runs.
  route('auth/google', 'routes/auth.google.tsx'),
  route('auth/google/callback', 'routes/auth.google.callback.tsx'),
  // Public school creation. Outside the _app layout, like /login: there is no session yet.
  route('signup', 'routes/signup.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('materials/:id/download', 'routes/materials.$id.download.tsx'),
  route('materials/:id/view', 'routes/materials.$id.view.tsx'),
  route('attendance', 'routes/attendance.tsx'),
  route('checkin', 'routes/checkin.tsx'),
  // PvP vocab battles (F33/F34): full-bleed screens outside the app shell, like checkin above —
  // a classroom projector or a shared tablet has no business showing the sidebar.
  route('game-rooms', 'routes/game-rooms.tsx'),
  route('battle/:code', 'routes/battle.$code.tsx'),
  route('faceoff/:slug', 'routes/faceoff.$slug.tsx'),
  route('event-materials', 'routes/event-materials.tsx'),
  route('class-materials', 'routes/class-materials.tsx'),
  route('event-previews', 'routes/event-previews.tsx'),
  // Page-view beacon (src/lib/track.ts). NOT under api/: that prefix is bearer-only, and the
  // beacon is a browser fetch/sendBeacon carrying a session cookie, same split as zalo-send-card.
  route('track', 'routes/track.tsx'),
  // Cookie-authed twin of api/garden/month/:id for the assessments report card. /api/* is
  // bearer-only, so a browser fetcher there gets a 401 — see routes/garden-month.tsx.
  route('garden-month', 'routes/garden-month.tsx'),
  // Cookie-authed attendance + homework for the report tab's rail — same twin reasoning.
  route('report-extras', 'routes/report-extras.tsx'),
  // Printable test document — outside the _app layout on purpose: no app shell, no nav chrome.
  route('tests/:id/print', 'routes/tests.$id.print.tsx'),
  // Printable tuition slip (phiếu thu), same reasoning.
  route('tuition/:month/:studentId/print', 'routes/tuition.$month.$studentId.print.tsx'),
  // Printable monthly report (phiếu nhận xét) — the only thing about assessments a parent sees,
  // so it is a document, not an app screen.
  route('assessments/:month/:studentId/report', 'routes/assessments.$month.$studentId.report.tsx'),
  // "Nhắc buổi sau" share card — an image for the class Zalo group, same reasoning again.
  route('session-preview/:eventId/:date/print', 'routes/session-preview.$eventId.$date.print.tsx'),
  // Class-garden share card — another image for the class group chat, so another document.
  route('garden/:classId/share', 'routes/garden.$classId.share.tsx'),
  route('enrich-vocab', 'routes/enrich-vocab.tsx'),
  route('generate-vocab', 'routes/generate-vocab.tsx'),
  // Pronunciation scoring (Azure Speech) for the pronounce game. Outside `_app` for the same
  // cache reason as enrich-vocab, and NOT under api/ because the web game posts with a session
  // cookie (the zalo-send-card split). Student-level auth — students are the players.
  route('speech-assess', 'routes/speech-assess.tsx'),
  // Pictures for vocabulary words. Search/generate/commit are staff-only and, like the two above,
  // outside `_app` so using the picker never invalidates the vocabulary route cache.
  route('vocab-image-search', 'routes/vocab-image-search.tsx'),
  route('vocab-image-generate', 'routes/vocab-image-generate.tsx'),
  route('vocab-image-commit', 'routes/vocab-image-commit.tsx'),

  // The API reference and the OpenAPI document it renders, generated from the route registry in
  // server/api/docs/. Staff-only through the cookie-or-bearer guard — the spec enumerates every
  // admin endpoint in the school. Outside `_app` because both return a raw Response: no app shell,
  // and no app.css reaching into Scalar's markup. See the route files.
  route('docs/api', 'routes/docs.api.tsx'),
  route('docs/openapi.json', 'routes/docs.openapi.tsx'),

  // ---- JSON API (mobile app; see docs/api.md) ----
  // Resource routes only: none of these has a default export, and none is inside the
  // _app layout — they must not inherit the app-shell loader or its cookie redirect.
  route('api/auth/login', 'routes/api.auth.login.tsx'),
  route('api/auth/logout', 'routes/api.auth.logout.tsx'),
  route('api/auth/me', 'routes/api.auth.me.tsx'),
  route('api/auth/redeem-invite', 'routes/api.auth.redeem-invite.tsx'),
  route('api/auth/request-reset', 'routes/api.auth.request-reset.tsx'),
  route('api/auth/otp-request', 'routes/api.auth.otp-request.tsx'),
  route('api/auth/otp-verify', 'routes/api.auth.otp-verify.tsx'),
  route('api/auth/otp-pick', 'routes/api.auth.otp-pick.tsx'),
  route('api/auth/otp-set-password', 'routes/api.auth.otp-set-password.tsx'),
  route('api/auth/change-password', 'routes/api.auth.change-password.tsx'),
  route('api/bootstrap', 'routes/api.bootstrap.tsx'),
  route('api/dashboard', 'routes/api.dashboard.tsx'),
  route('api/events/:id?', 'routes/api.events.tsx'),
  route('api/classes/:id?', 'routes/api.classes.tsx'),
  route('api/students/:id?', 'routes/api.students.tsx'),
  route('api/staff/:id?', 'routes/api.staff.tsx'),
  route('api/parents/:id?', 'routes/api.parents.tsx'),
  route('api/invites/:id?', 'routes/api.invites.tsx'),
  route('api/materials/:id?', 'routes/api.materials.tsx'),
  route('api/assessments/scores/:id?', 'routes/api.assessments.scores.tsx'),
  route('api/assessments/behavior/:id?', 'routes/api.assessments.behavior.tsx'),
  route('api/assessments/remarks/:id?', 'routes/api.assessments.remarks.tsx'),
  route('api/assessment-types/reorder', 'routes/api.assessment-types.reorder.tsx'),
  route('api/assessment-types/:id?', 'routes/api.assessment-types.tsx'),
  route('api/remark-criteria/reorder', 'routes/api.remark-criteria.reorder.tsx'),
  route('api/remark-criteria/:id?', 'routes/api.remark-criteria.tsx'),
  route('api/grade-levels/reorder', 'routes/api.grade-levels.reorder.tsx'),
  route('api/grade-levels/:id?', 'routes/api.grade-levels.tsx'),
  route('api/subjects/:id?', 'routes/api.subjects.tsx'),
  route('api/attendance', 'routes/api.attendance.tsx'),
  route('api/event-materials', 'routes/api.event-materials.tsx'),
  route('api/class-materials', 'routes/api.class-materials.tsx'),
  route('api/event-previews', 'routes/api.event-previews.tsx'),
  route('api/my-sessions', 'routes/api.my-sessions.tsx'),
  route('api/flashcards/topics/:id?', 'routes/api.flashcards.topics.tsx'),
  route('api/flashcards/topic/:slug', 'routes/api.flashcards.topics.$slug.tsx'),
  route('api/flashcards/words/:id?', 'routes/api.flashcards.words.tsx'),
  route('api/flashcards/import', 'routes/api.flashcards.import.tsx'),
  // Not under `topics/`: that route's `:id?` would swallow a literal `generate-topic` segment.
  route('api/flashcards/generate-topic', 'routes/api.flashcards.generate-topic.tsx'),
  route('api/flashcards/results', 'routes/api.flashcards.results.tsx'),
  route('api/flashcards/stats', 'routes/api.flashcards.stats.tsx'),
  // PvP vocab battles (F33/F34). /api/* is bearer-only for the mobile app; game-rooms.tsx is
  // the cookie-authed twin the web battle/face-off screens use.
  route('api/game-rooms', 'routes/api.game-rooms.tsx'),
  route('api/pvp/ladder', 'routes/api.pvp.ladder.tsx'),
  // Garden. `progress` is NOT under `assignments/`: that route's `:id?` would swallow the
  // literal segment, the same trap as `api/flashcards/generate-topic` above.
  route('api/garden/plant', 'routes/api.garden.plant.tsx'),
  route('api/garden/harvest', 'routes/api.garden.harvest.tsx'),
  route('api/garden/class/:id', 'routes/api.garden.class.$id.tsx'),
  route('api/garden/water', 'routes/api.garden.water.tsx'),
  route('api/garden/assignments/:id?', 'routes/api.garden.assignments.$id.tsx'),
  route('api/garden/progress/:id', 'routes/api.garden.progress.$id.tsx'),
  route('api/garden/month/:id', 'routes/api.garden.month.$id.tsx'),
  route('api/garden/snapshots', 'routes/api.garden.snapshots.tsx'),
  route('api/feedback/:id?', 'routes/api.feedback.tsx'),
  route('api/checkin/summary', 'routes/api.checkin.summary.tsx'),
  route('api/profile', 'routes/api.profile.tsx'),
  route('api/settings/theme', 'routes/api.settings.theme.tsx'),
  route('api/settings/ui-prefs', 'routes/api.settings.ui-prefs.tsx'),
  route('api/settings/ui-prefs/me', 'routes/api.settings.ui-prefs.me.tsx'),
  route('api/settings/notifications', 'routes/api.settings.notifications.tsx'),
  route('api/settings/garden', 'routes/api.settings.garden.tsx'),
  route('api/settings/parent-portal', 'routes/api.settings.parent-portal.tsx'),
  // The parent portal's own namespace. Every one of these is `withAuth('parent')` — staff and
  // students 403 — and every one starts by asking parent-portal.ts whether the toggle is on and
  // whether the child in the path is actually theirs.
  route('api/parent/home', 'routes/api.parent.home.tsx'),
  route('api/parent/attendance/:studentId', 'routes/api.parent.attendance.$studentId.tsx'),
  route('api/parent/report/:studentId/:month', 'routes/api.parent.report.$studentId.$month.tsx'),
  route('api/parent/tuition/:studentId/:month', 'routes/api.parent.tuition.$studentId.$month.tsx'),
  route('api/push/register', 'routes/api.push.register.tsx'),
  route('api/push/unregister', 'routes/api.push.unregister.tsx'),
  route('api/push/run', 'routes/api.push.run.tsx'),
  // Zalo bot channel. The webhook is the only public /api route besides auth — it is gated on
  // the X-Bot-Api-Secret-Token header instead of a session, because Zalo's servers have neither.
  route('api/zalo/webhook', 'routes/api.zalo.webhook.tsx'),
  route('api/zalo/pair', 'routes/api.zalo.pair.tsx'),
  route('api/zalo/admin', 'routes/api.zalo.admin.tsx'),
  // NOT under api/: that prefix is bearer-only, and every caller is a browser with a session
  // cookie. See the route file, and garden-month.tsx for the same trap.
  route('zalo-send-card', 'routes/zalo-send-card.tsx'),
  // Share-card images, fetched by Zalo's own servers — one of two unauthenticated R2 routes in
  // the app, and it can only reach the `zalo/` prefix. See the file for why that is unavoidable.
  route('zalo-media/:key', 'routes/zalo-media.$key.tsx'),
  // Vocabulary word pictures. The other unauthenticated R2 route, reaching only `flashcards/`:
  // students render these from the mobile app, which has no cookie to send. Same capability-URL
  // trust model as zalo-media above.
  route('flashcard-images/:key', 'routes/flashcard-images.$key.tsx'),

  // The vocabulary pages used to live at /flashcards. Keep the old URLs working — bookmarks,
  // and push notifications sent before the rename that still carry `url: '/flashcards'`.
  // Outside the `_app` layout: a redirect has no business loading the app shell.
  route('flashcards', 'routes/flashcards.legacy.tsx'),
  route('flashcards/:slug', 'routes/flashcards.legacy.$slug.tsx'),

  layout('routes/_app.tsx', [
    route('dashboard', 'routes/dashboard.tsx'),
    route('calendar', 'routes/calendar.tsx'),
    route('classes', 'routes/classes.tsx'),
    route('people', 'routes/people.tsx'),
    route('materials', 'routes/materials.tsx'),
    route('tests', 'routes/tests.tsx'),
    route('tests/:id', 'routes/tests.$id.tsx'),
    route('my-tests', 'routes/my-tests.tsx'),
    route('my-tests/:id', 'routes/my-tests.$id.tsx'),
    route('my-schedule', 'routes/my-schedule.tsx'),
    route('questions', 'routes/questions.tsx'),
    route('assessments', 'routes/assessments.tsx'),
    // Month in the PATH for the same cache reason as tuition below.
    route('rankings/:month?', 'routes/rankings.tsx'),
    route('vocabulary', 'routes/flashcards.tsx'),
    route('vocabulary/:slug', 'routes/flashcards.$slug.tsx'),
    // A SIBLING of the garden, not a child of it. `/garden/species` would be captured by the
    // optional `:classId` below, and — even with a static segment declared first — NavLink marks
    // ancestors active by prefix, so the sidebar would light up the class garden and expand the
    // wrong section. Admin-only, enforced in the route with requireAdmin.
    route('garden-species', 'routes/garden-species.tsx'),
    // Class id (and the album's month) in the PATH for the same cache reason as tuition below.
    route('garden/:classId?', 'routes/garden.tsx'),
    route('garden/:classId/album/:month', 'routes/garden.$classId.album.$month.tsx'),
    // Túi mù class board. Class id + month in the PATH, same cache reasoning as tuition/garden.
    // The URL is English (`/mystery-bag`) while the file and every internal name stay `tui-mu` —
    // the same split as /vocabulary → routes/flashcards.tsx above.
    route('mystery-bag/:classId?/:month?', 'routes/tui-mu.tsx'),
    // The month sits in the PATH, not a query string: cacheKeyForPath only sees pathnames, so a
    // `?month=` would give every month the same cache entry.
    route('tuition/:month?', 'routes/tuition.tsx'),
    route('config', 'routes/config.tsx'),
    // Platform admins only (dev@ / admin@). A school's own Admin must never reach it.
    route('platform', 'routes/platform.tsx'),
    // Admin diagnostics. The student filter sits in the PATH for the same cache reason as the
    // months above: cacheKeyForPath only sees pathnames.
    //
    // The static segment MUST be declared: without it `/logs/notifications` would match
    // `:studentId` below and be treated as a student filter. React Router ranks static segments
    // above dynamic ones regardless of order, but the order documents the intent.
    route('logs/notifications', 'routes/logs.notifications.tsx'),
    // Same static-segment-before-dynamic reasoning as logs/notifications above: without this,
    // /logs/activity would match :studentId and be treated as a student filter. See the
    // cacheKeyForPath early-return in src/lib/route-cache.ts for the other half of that fix.
    route('logs/activity', 'routes/logs.activity.tsx'),
    // Same static-segment-before-dynamic reasoning again: /logs/usage must not be read as a
    // student filter by :studentId below.
    route('logs/usage', 'routes/logs.usage.tsx'),
    route('logs/:studentId?', 'routes/logs.tsx'),
    route('feedback', 'routes/feedback.tsx'),
    route('profile', 'routes/profile.tsx'),
    // The parent portal. Gated twice: `parentOk` in sidebar-nav.tsx hides the nav item and
    // PARENT_PATHS in _app.tsx refuses the path, both keyed on the admin toggle. Month in the
    // PATH for the same cache reason as tuition above.
    route('children', 'routes/children.tsx'),
    route('children/:studentId/:month?', 'routes/children.$studentId.tsx'),
  ]),
] satisfies RouteConfig;
