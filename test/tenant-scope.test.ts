import { readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import * as schema from '../server/db/schema';

/**
 * The tripwire that stops an unscoped query shipping.
 *
 * Multi-tenancy here is enforced in code, not by the database: `TenantDb` makes the scoped
 * spelling the short one, but nothing stops someone reaching past it to `db.raw` and writing a
 * query that reads every school's rows. That mistake is invisible in review (the query looks
 * fine, and in a one-school test environment it even behaves fine) and catastrophic in
 * production, so it gets a static check — the same shape as `api-docs-completeness.test.ts`,
 * which guards the same class of silent omission.
 *
 * Two rules:
 *
 *   1. `createRawDb` may only be imported by modules that genuinely have no school in hand.
 *   2. Any statement selecting FROM a tenant-scoped table must carry `db.own(` / `db.pool(`,
 *      or an explicit `tenant-unscoped:` comment saying why not.
 *
 * The escape hatch is deliberate and deliberately noisy. Several reads are legitimately global —
 * an invite code typed by a visitor with no session, a retention sweep, a globally unique
 * feedback ref — and the comment turns each one into a decision a reviewer can see rather than
 * an omission they cannot.
 */

const ROOT = process.cwd();

/**
 * Derived from the schema rather than hand-listed, so a table that gains `tenant_id` later is
 * covered the day it does — with no list to remember to update.
 */
const TENANT_TABLES = new Set(
  Object.entries(schema)
    .filter(([, t]) => t && typeof t === 'object' && 'tenantId' in (t as object))
    .map(([name]) => name),
);

/**
 * Modules allowed to build an unscoped handle, each because it runs before a school is known:
 * the auth chokepoint that resolves one, the public routes that predate a session, the cron
 * loop that iterates every school, the platform surface that exists to look across them, and
 * the Durable Objects, which have no request context at all.
 */
const RAW_DB_ALLOWLIST = [
  'server/db/index.ts',
  'server/db/tenant.ts',
  'server/db/internal.ts',
  'server/services/auth.ts',
  'server/services/audit.ts',
  'server/services/notify.ts',
  'server/services/tenants.ts',
  'server/api/handler.ts',
  'server/api/auth.ts',
  'app/routes/login.tsx',
  'app/routes/logout.tsx',
  'app/routes/signup.tsx',
  'app/routes/platform.tsx',
  'workers/',
];

function walk(dir: string, out: string[] = []): string[] {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.(ts|tsx)$/.test(entry)) out.push(full);
  }
  return out;
}

const FILES = [
  ...walk(resolve(ROOT, 'server')),
  ...walk(resolve(ROOT, 'app/routes')),
  ...walk(resolve(ROOT, 'workers')),
].map((f) => ({
  path: f.slice(ROOT.length + 1).replace(/\\/g, '/'),
  src: readFileSync(f, 'utf8'),
}));

describe('tenant scoping', () => {
  it('only sanctioned modules can build an unscoped database handle', () => {
    const offenders = FILES.filter(
      (f) =>
        /from '.*db\/internal'/.test(f.src) &&
        !RAW_DB_ALLOWLIST.some((allowed) => f.path === allowed || f.path.startsWith(allowed)),
    ).map((f) => f.path);

    expect(offenders, `import createRawDb outside the allowlist:\n${offenders.join('\n')}`).toEqual(
      [],
    );
  });

  it('every read of a tenant-scoped table is fenced or explicitly excused', () => {
    const offenders: string[] = [];

    // The unit of analysis is the FUNCTION, not the statement. The fence is routinely hoisted
    // (`const key = db.own(classPrices, …)` a few lines above the query it guards), and a
    // statement-level check calls that unscoped — a tripwire that cries wolf is one that gets
    // deleted, so it is worth the coarser grain.
    const SPLIT = /\n(?=(?:export )?(?:async )?function )/;

    for (const file of FILES) {
      const units = file.src.split(SPLIT);
      units.forEach((unit, i) => {
        const tables = [...unit.matchAll(/\.from\(\s*(\w+)\s*\)/g)]
          .map((m) => m[1])
          .filter((t) => TENANT_TABLES.has(t));
        if (!tables.length) return;
        // The fence must be inside the function; the excuse may be in the docblock directly
        // above it, which the split leaves at the tail of the previous unit.
        const preamble = (units[i - 1] ?? '').slice(-900);
        const fenced =
          unit.includes('.own(') ||
          unit.includes('.pool(') ||
          unit.includes('tenant-unscoped') ||
          preamble.includes('tenant-unscoped');
        if (!fenced) offenders.push(`${file.path}: .from(${[...new Set(tables)].join(', ')})`);
      });
    }

    expect(
      offenders,
      `unscoped reads of tenant tables — add db.own(...) or a "// tenant-unscoped: <reason>" comment:\n${offenders.join('\n')}`,
    ).toEqual([]);
  });

  it('knows which tables are tenant-scoped', () => {
    // A canary on the derivation above: if this drops to zero the first test silently passes
    // for every file in the repo.
    expect(TENANT_TABLES.size).toBeGreaterThan(25);
    expect(TENANT_TABLES.has('classes')).toBe(true);
    expect(TENANT_TABLES.has('settings')).toBe(true);
    // Reached only through a scoped parent, so deliberately absent.
    expect(TENANT_TABLES.has('flashcardWords')).toBe(false);
    expect(TENANT_TABLES.has('userSettings')).toBe(false);
    // Global BY DECISION, not by omission: khối 6-9 is a national concept and the vocabulary
    // curriculum library keys curricula by it (migration 0049), so there is one shared list and
    // writes are platform-admin-only. Without this line, someone re-adding `tenantId` in a merge
    // would silently re-fence the table and nothing would complain.
    expect(TENANT_TABLES.has('gradeLevels')).toBe(false);
    // The tag catalog is global for the same kind of reason: "Food & Cooking" is not per-school.
    expect(TENANT_TABLES.has('vocabTopics')).toBe(false);
    expect(TENANT_TABLES.has('vocabWordTopics')).toBe(false);
  });
});
