import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { registry } from '../server/api/docs/registry';

/**
 * The tripwire that stops an endpoint shipping undocumented.
 *
 * `app/routes.ts` is the only place a URL under /api/ can come into existence, so comparing it
 * against the doc registry catches both directions: a new route nobody described, and a described
 * route that has since been renamed or deleted. There is deliberately no exclusion list — if an
 * endpoint is genuinely not worth documenting, that is a conversation, not a quiet skip.
 */

// Vitest runs from the repo root; `import.meta.url` is not a file URL after transformation.
const routesTs = readFileSync(resolve(process.cwd(), 'app/routes.ts'), 'utf8');

/** Every `route('api/…', …)` pattern, exactly as written. */
const declared = new Set([...routesTs.matchAll(/route\('(api\/[^']+)'/g)].map((m) => m[1]));

const documented = new Set(registry.map((r) => r.routePattern));

describe('API doc coverage', () => {
  it('finds the api routes in app/routes.ts', () => {
    // Guards the regex itself: a refactor that changes how routes are declared must not
    // silently reduce this to zero and make every assertion below pass vacuously.
    expect(declared.size).toBeGreaterThan(50);
  });

  it('documents every /api/* route', () => {
    const missing = [...declared].filter((p) => !documented.has(p)).sort();
    expect(
      missing,
      `Undocumented API routes. Add an entry to server/api/docs/registry.ts for:\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no entry for a route that no longer exists', () => {
    const stale = [...documented].filter((p) => !declared.has(p)).sort();
    expect(
      stale,
      `Registry entries whose route is gone from app/routes.ts:\n  ${stale.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('registry shape', () => {
  it('gives every path at least one operation', () => {
    const empty = registry.filter((r) => r.operations.length === 0).map((r) => r.path);
    expect(empty).toEqual([]);
  });

  it('never declares the same method twice on one path', () => {
    const dupes: string[] = [];
    for (const entry of registry) {
      const seen = new Set<string>();
      for (const op of entry.operations) {
        if (seen.has(op.method)) dupes.push(`${op.method.toUpperCase()} ${entry.path}`);
        seen.add(op.method);
      }
    }
    expect(dupes).toEqual([]);
  });

  it('uses OpenAPI path syntax, not React Router syntax', () => {
    const wrong = registry.filter((r) => r.path.includes(':')).map((r) => r.path);
    expect(wrong, 'Use /api/thing/{id}, not /api/thing/:id').toEqual([]);
  });

  it('declares a path param for every {placeholder}', () => {
    const missing: string[] = [];
    for (const entry of registry) {
      const placeholders = [...entry.path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
      for (const op of entry.operations) {
        const declaredParams = new Set(
          (op.params ?? []).filter((p) => p.in === 'path').map((p) => p.name),
        );
        for (const name of placeholders) {
          if (!declaredParams.has(name)) {
            missing.push(`${op.method.toUpperCase()} ${entry.path} -> {${name}}`);
          }
        }
      }
    }
    expect(missing).toEqual([]);
  });
});
