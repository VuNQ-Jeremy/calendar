import { drizzle } from 'drizzle-orm/d1';
import * as schema from './schema';

/**
 * The unscoped drizzle handle.
 *
 * Deliberately not exported from `server/db` — an eslint `no-restricted-imports` rule allows
 * this module only from the places that legitimately have no school in hand yet (the auth
 * chokepoint, the public signup/login routes, the cron loop that iterates schools, the Durable
 * Objects) and from `tenant.ts`, which wraps it.
 *
 * Everything else takes a `TenantDb`. That is the whole guardrail: reaching for an unscoped
 * query has to be a deliberate, reviewable act rather than the path of least resistance.
 */
export const createRawDb = (env: Env) => drizzle(env.DB, { schema });

export type Db = ReturnType<typeof createRawDb>;
