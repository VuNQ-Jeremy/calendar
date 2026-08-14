import { describe, it, expect } from 'vitest';
import { env } from 'cloudflare:test';
import { createDb } from '../server/db/index';
import * as authSvc from '../server/services/auth';
import * as peopleSvc from '../server/services/people';
import { hashPassword } from '../server/services/crypto';
import { accounts } from '../server/db/schema';
import { requireStaffCookieOrBearer } from '../server/api/auth';
import { MOBILE_TTL_DAYS } from '../server/api/auth';
import { registry } from '../server/api/docs/registry';
import { getSpecJson } from '../server/api/docs/build-spec';

/**
 * The API reference: who may read it, and whether it still describes the routes that exist.
 *
 * Two separate worries.
 *
 * The first is access. `/docs/api` and `/docs/openapi.json` sit outside `/api/*` and are read
 * both by a signed-in browser and by curl, so they use the hybrid guard rather than the
 * bearer-only one — and the spec enumerates every admin endpoint in the school, so getting that
 * guard wrong is the whole risk of shipping this page.
 *
 * The second is method-level drift. `test/api-docs-completeness.test.ts` already proves every
 * route HAS an entry; this file proves the entry has the right verbs, which needs the route
 * modules themselves — and importing those needs a Workers runtime, hence the pool split.
 */

function db() {
  return createDb(env);
}

async function seedStaff(d, email, role = 'Teacher') {
  const staffRow = await peopleSvc.createStaff(d, {
    name: 'Docs Staff',
    email,
    role,
    color: 'orange',
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword('pw'),
    staffId: staffRow.id,
    createdAt: new Date().toISOString(),
  });
  return accountId;
}

async function seedStudent(d, email) {
  const studentRow = await peopleSvc.createStudent(d, {
    name: 'Docs Student',
    email,
    color: 'blue',
    classIds: [],
  });
  const accountId = crypto.randomUUID();
  await d.insert(accounts).values({
    id: accountId,
    email: email.toLowerCase(),
    passwordHash: await hashPassword('pw'),
    studentId: studentRow.id,
    createdAt: new Date().toISOString(),
  });
  return accountId;
}

const bearer = (token) =>
  new Request('http://localhost/docs/openapi.json', {
    headers: { Authorization: `Bearer ${token}` },
  });

describe('who may read the API reference', () => {
  it('lets a staff bearer token through', async () => {
    const d = db();
    const accountId = await seedStaff(d, 'docs-staff@mochi.edu');
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const user = await requireStaffCookieOrBearer(bearer(token), env);
    expect(user.kind).toBe('staff');
  });

  it('refuses a student bearer token with a JSON 403', async () => {
    const d = db();
    const accountId = await seedStudent(d, 'docs-student@mochi.edu');
    const token = await authSvc.createSession(d, accountId, true, MOBILE_TTL_DAYS);

    const thrown = await requireStaffCookieOrBearer(bearer(token), env).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(403);
    expect(await thrown.json()).toEqual({ error: 'forbidden' });
  });

  it('refuses a garbage bearer token with a JSON 401', async () => {
    const thrown = await requireStaffCookieOrBearer(bearer('not-a-token'), env).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBe(401);
    expect(await thrown.json()).toEqual({ error: 'unauthorized' });
  });

  it('redirects a browser with no session, rather than 401ing it', async () => {
    // No Authorization header means a browser, and a browser should land on the login page —
    // this is the half of the hybrid guard that makes /docs/api usable by a person.
    const thrown = await requireStaffCookieOrBearer(
      new Request('http://localhost/docs/api'),
      env,
    ).catch((e) => e);
    expect(thrown).toBeInstanceOf(Response);
    expect(thrown.status).toBeGreaterThanOrEqual(300);
    expect(thrown.status).toBeLessThan(400);
    expect(thrown.headers.get('Location')).toContain('/login');
  });
});

describe('the served document', () => {
  it('is valid JSON describing this deployment', () => {
    const spec = JSON.parse(getSpecJson('https://mochi.example'));
    expect(spec.openapi).toMatch(/^3\.1\./);
    expect(spec.servers).toEqual([{ url: 'https://mochi.example' }]);
    expect(Object.keys(spec.paths).length).toBeGreaterThan(70);
  });

  it('is cached after the first build', () => {
    // Same string identity on the second call: the document is assembled once per isolate.
    expect(getSpecJson('https://mochi.example')).toBe(getSpecJson('https://ignored.example'));
  });
});

/* ── Method-level drift ────────────────────────────────────────────────────────────────────── */

/** routePattern -> route module path, read straight out of app/routes.ts. */
const ROUTE_FILES = new Map([
  ['api/auth/login', 'api.auth.login'],
  ['api/auth/logout', 'api.auth.logout'],
  ['api/auth/me', 'api.auth.me'],
  ['api/auth/redeem-invite', 'api.auth.redeem-invite'],
  ['api/auth/request-reset', 'api.auth.request-reset'],
  ['api/auth/change-password', 'api.auth.change-password'],
  ['api/bootstrap', 'api.bootstrap'],
  ['api/dashboard', 'api.dashboard'],
  ['api/events/:id?', 'api.events'],
  ['api/classes/:id?', 'api.classes'],
  ['api/students/:id?', 'api.students'],
  ['api/staff/:id?', 'api.staff'],
  ['api/parents/:id?', 'api.parents'],
  ['api/invites/:id?', 'api.invites'],
  ['api/materials/:id?', 'api.materials'],
  ['api/assessments/scores/:id?', 'api.assessments.scores'],
  ['api/assessments/behavior/:id?', 'api.assessments.behavior'],
  ['api/assessments/remarks/:id?', 'api.assessments.remarks'],
  ['api/assessment-types/reorder', 'api.assessment-types.reorder'],
  ['api/assessment-types/:id?', 'api.assessment-types'],
  ['api/remark-criteria/reorder', 'api.remark-criteria.reorder'],
  ['api/remark-criteria/:id?', 'api.remark-criteria'],
  ['api/grade-levels/reorder', 'api.grade-levels.reorder'],
  ['api/grade-levels/:id?', 'api.grade-levels'],
  ['api/subjects/:id?', 'api.subjects'],
  ['api/attendance', 'api.attendance'],
  ['api/event-materials', 'api.event-materials'],
  ['api/event-previews', 'api.event-previews'],
  ['api/my-sessions', 'api.my-sessions'],
  ['api/flashcards/topics/:id?', 'api.flashcards.topics'],
  ['api/flashcards/topic/:slug', 'api.flashcards.topics.$slug'],
  ['api/flashcards/words/:id?', 'api.flashcards.words'],
  ['api/flashcards/import', 'api.flashcards.import'],
  ['api/flashcards/generate-topic', 'api.flashcards.generate-topic'],
  ['api/flashcards/results', 'api.flashcards.results'],
  ['api/flashcards/stats', 'api.flashcards.stats'],
  ['api/garden/plant', 'api.garden.plant'],
  ['api/garden/harvest', 'api.garden.harvest'],
  ['api/garden/class/:id', 'api.garden.class.$id'],
  ['api/garden/water', 'api.garden.water'],
  ['api/garden/assignments/:id?', 'api.garden.assignments.$id'],
  ['api/garden/progress/:id', 'api.garden.progress.$id'],
  ['api/garden/month/:id', 'api.garden.month.$id'],
  ['api/garden/snapshots', 'api.garden.snapshots'],
  ['api/feedback/:id?', 'api.feedback'],
  ['api/checkin/summary', 'api.checkin.summary'],
  ['api/profile', 'api.profile'],
  ['api/settings/theme', 'api.settings.theme'],
  ['api/settings/ui-prefs', 'api.settings.ui-prefs'],
  ['api/settings/notifications', 'api.settings.notifications'],
  ['api/settings/garden', 'api.settings.garden'],
  ['api/settings/parent-portal', 'api.settings.parent-portal'],
  ['api/parent/home', 'api.parent.home'],
  ['api/parent/attendance/:studentId', 'api.parent.attendance.$studentId'],
  ['api/parent/report/:studentId/:month', 'api.parent.report.$studentId.$month'],
  ['api/parent/tuition/:studentId/:month', 'api.parent.tuition.$studentId.$month'],
  ['api/push/register', 'api.push.register'],
  ['api/push/unregister', 'api.push.unregister'],
  ['api/push/run', 'api.push.run'],
  ['api/zalo/webhook', 'api.zalo.webhook'],
  ['api/zalo/pair', 'api.zalo.pair'],
  ['api/zalo/admin', 'api.zalo.admin'],
]);

/** What the registry claims each route serves, folded across both of its paths. */
function claimedMethods() {
  const byPattern = new Map();
  for (const entry of registry) {
    const set = byPattern.get(entry.routePattern) ?? new Set();
    for (const op of entry.operations) set.add(op.method);
    byPattern.set(entry.routePattern, set);
  }
  return byPattern;
}

describe('documented verbs match the route modules', () => {
  it('covers every registry pattern with a module path', () => {
    const missing = [...claimedMethods().keys()].filter((p) => !ROUTE_FILES.has(p));
    expect(missing, 'Add the new route to ROUTE_FILES in this test').toEqual([]);
  });

  it('documents a GET exactly where a loader exists, and a write exactly where an action does', async () => {
    const problems = [];
    for (const [pattern, methods] of claimedMethods()) {
      const file = ROUTE_FILES.get(pattern);
      if (!file) continue;
      const mod = await import(`../app/routes/${file}.tsx`);

      const docsGet = methods.has('get');
      const docsWrite = [...methods].some((m) => m !== 'get');

      if (docsGet && !mod.loader) problems.push(`${pattern}: documents GET but exports no loader`);
      if (!docsGet && mod.loader)
        problems.push(`${pattern}: exports a loader but documents no GET`);
      if (docsWrite && !mod.action) {
        problems.push(`${pattern}: documents a write but exports no action`);
      }
      if (!docsWrite && mod.action) {
        problems.push(`${pattern}: exports an action but documents no write`);
      }
    }
    expect(problems).toEqual([]);
  });
});
