import { type RouteConfig, index, layout, route } from '@react-router/dev/routes';

export default [
  route('login', 'routes/login.tsx'),
  route('logout', 'routes/logout.tsx'),
  route('materials/:id/download', 'routes/materials.$id.download.tsx'),
  route('materials/:id/view', 'routes/materials.$id.view.tsx'),
  route('attendance', 'routes/attendance.tsx'),
  route('event-materials', 'routes/event-materials.tsx'),
  route('event-previews', 'routes/event-previews.tsx'),
  // Cookie-authed twin of api/garden/month/:id for the assessments report card. /api/* is
  // bearer-only, so a browser fetcher there gets a 401 — see routes/garden-month.tsx.
  route('garden-month', 'routes/garden-month.tsx'),
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

  // ---- JSON API (mobile app; see docs/api.md) ----
  // Resource routes only: none of these has a default export, and none is inside the
  // _app layout — they must not inherit the app-shell loader or its cookie redirect.
  route('api/auth/login', 'routes/api.auth.login.tsx'),
  route('api/auth/logout', 'routes/api.auth.logout.tsx'),
  route('api/auth/me', 'routes/api.auth.me.tsx'),
  route('api/auth/redeem-invite', 'routes/api.auth.redeem-invite.tsx'),
  route('api/auth/request-reset', 'routes/api.auth.request-reset.tsx'),
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
  route('api/attendance', 'routes/api.attendance.tsx'),
  route('api/event-materials', 'routes/api.event-materials.tsx'),
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
  route('api/profile', 'routes/api.profile.tsx'),
  route('api/settings/theme', 'routes/api.settings.theme.tsx'),
  route('api/settings/ui-prefs', 'routes/api.settings.ui-prefs.tsx'),
  route('api/settings/notifications', 'routes/api.settings.notifications.tsx'),
  route('api/settings/garden', 'routes/api.settings.garden.tsx'),
  // Tuition, student self-view. All-literal prefixes under `me`, so no `:id?` can swallow them.
  route('api/tuition/me', 'routes/api.tuition.me.tsx'),
  route('api/tuition/me/:month', 'routes/api.tuition.me.$month.tsx'),
  route('api/tuition/me/:month/slip', 'routes/api.tuition.me.$month.slip.tsx'),
  route('api/push/register', 'routes/api.push.register.tsx'),
  route('api/push/unregister', 'routes/api.push.unregister.tsx'),
  route('api/push/run', 'routes/api.push.run.tsx'),
  // Zalo bot channel. The webhook is the only public /api route besides auth — it is gated on
  // the X-Bot-Api-Secret-Token header instead of a session, because Zalo's servers have neither.
  route('api/zalo/webhook', 'routes/api.zalo.webhook.tsx'),
  route('api/zalo/pair', 'routes/api.zalo.pair.tsx'),
  route('api/zalo/admin', 'routes/api.zalo.admin.tsx'),
  route('api/zalo/send-card', 'routes/api.zalo.send-card.tsx'),
  // Share-card images, fetched by Zalo's own servers — the only unauthenticated R2 route in the
  // app, and it can only reach the `zalo/` prefix. See the file for why that is unavoidable.
  route('zalo-media/:key', 'routes/zalo-media.$key.tsx'),

  // The vocabulary pages used to live at /flashcards. Keep the old URLs working — bookmarks,
  // and push notifications sent before the rename that still carry `url: '/flashcards'`.
  // Outside the `_app` layout: a redirect has no business loading the app shell.
  route('flashcards', 'routes/flashcards.legacy.tsx'),
  route('flashcards/:slug', 'routes/flashcards.legacy.$slug.tsx'),

  layout('routes/_app.tsx', [
    index('routes/home.tsx'),
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
    // Class id (and the album's month) in the PATH for the same cache reason as tuition below.
    route('garden/:classId?', 'routes/garden.tsx'),
    route('garden/:classId/album/:month', 'routes/garden.$classId.album.$month.tsx'),
    // The month sits in the PATH, not a query string: cacheKeyForPath only sees pathnames, so a
    // `?month=` would give every month the same cache entry.
    route('tuition/:month?', 'routes/tuition.tsx'),
    route('config', 'routes/config.tsx'),
    route('feedback', 'routes/feedback.tsx'),
    route('profile', 'routes/profile.tsx'),
  ]),
] satisfies RouteConfig;
