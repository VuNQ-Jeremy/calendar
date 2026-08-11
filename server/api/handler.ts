import type { z } from 'zod';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { createDb, type Db } from '../db';
import { cloudflareCtx } from '../../app/load-context';
import { parsePatch } from '../../shared/schemas';
import type { SessionUser, LearnerUser, ParentUser } from '../services/auth';
import {
  requireApiUser,
  requireApiLearner,
  requireApiParent,
  requireApiStaff,
  requireApiAdmin,
} from './auth';
import { eq } from 'drizzle-orm';
import { notifyLive } from '../live';
import type { MutationDomain } from '../../shared/live';
import { hasCrudEntry, noteAction, record, recordCreate, recordDelete } from '../services/audit';
import type { TableWithId } from '../services/audit';

/** POST/PATCH/DELETE map onto the activity log's own vocabulary for the coarse withAuth fallback. */
const COARSE_ACTION_FOR_METHOD: Record<string, 'create' | 'update' | 'delete'> = {
  POST: 'create',
  PATCH: 'update',
  DELETE: 'delete',
};

/**
 * Plumbing for the JSON API. Contains NO business logic — every route calls the same
 * server/services/* functions the web loaders and actions use.
 *
 * Envelope: `{ data }` on success, `{ error, issues? }` on failure. Never a redirect.
 */

/**
 * 'any' — every signed-in kind, parents included. Reserved for endpoints about the caller
 *   themselves: profile, prefs, push tokens, logout.
 * 'user' — staff or student. The default for shared surfaces, because their handlers branch
 *   `student ? own : all` and a parent falling into the else-branch would read the school.
 * 'parent' — parents only, for /api/parent/*. The inverse of 'user': these handlers scope
 *   everything to `parent_students`, so no other kind has an answer here. Each one still asks
 *   parent-portal.ts whether the portal is switched on — this level is identity, not access.
 */
export type AuthLevel = 'any' | 'user' | 'parent' | 'staff' | 'admin';

/**
 * 'any' sees every kind; 'parent' sees exactly one; the rest have already turned parents away
 * and get the narrowed session the flashcard and garden services require. The narrowing is
 * load-bearing: a parent handler cannot compile against a staff id and vice versa.
 */
type UserFor<L extends AuthLevel> = L extends 'any'
  ? SessionUser
  : L extends 'parent'
    ? ParentUser
    : LearnerUser;

export type ApiCtx<L extends AuthLevel = AuthLevel> = {
  user: UserFor<L>;
  db: Db;
  env: Env;
  ctx: ExecutionContext;
  request: Request;
  params: Record<string, string | undefined>;
};

const CORS_HEADERS = {
  // Native fetch ignores CORS entirely; this is for the Expo web target and curl debugging.
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
  'Access-Control-Allow-Headers': 'Authorization,Content-Type',
  'Access-Control-Max-Age': '86400',
};

export function ok<T>(data: T, status = 200): Response {
  return Response.json({ data }, { status, headers: CORS_HEADERS });
}

export function fail(error: string, status: number, issues?: unknown): Response {
  return Response.json(issues ? { error, issues } : { error }, { status, headers: CORS_HEADERS });
}

/** Preflight. Routes export this as their OPTIONS path via the shared action. */
export function corsPreflight(): Response {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

async function resolveUser(level: AuthLevel, request: Request, env: Env): Promise<SessionUser> {
  if (level === 'admin') return requireApiAdmin(request, env);
  if (level === 'staff') return requireApiStaff(request, env);
  if (level === 'user') return requireApiLearner(request, env);
  if (level === 'parent') return requireApiParent(request, env);
  return requireApiUser(request, env);
}

/**
 * Wrap a handler with auth, CORS and uniform error handling.
 *
 * A handler may return a Response directly (for streams) or any JSON-serialisable value,
 * which gets wrapped in `{ data }`. Guards throw a Response; anything else becomes a 500
 * with the detail logged server-side rather than leaked to the client.
 */
export function withAuth<T, L extends AuthLevel>(
  level: L,
  handler: (ctx: ApiCtx<L>) => Promise<T>,
  opts?: {
    /**
     * Broadcast this domain to connected web clients after a successful write,
     * so a change made in the mobile app shows up in an open browser tab.
     * Reads never broadcast.
     */
    live?: MutationDomain;
  },
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<Response> {
  return async ({ request, params, context }) => {
    if (request.method === 'OPTIONS') return corsPreflight();
    const { env, ctx: execCtx } = context.get(cloudflareCtx);
    try {
      const user = await resolveUser(level, request, env);
      const result = await handler({
        user: user as UserFor<L>,
        db: createDb(env),
        env,
        ctx: execCtx,
        request,
        params: params as Record<string, string | undefined>,
      });
      const response = result instanceof Response ? result : ok(result);
      const isWrite = request.method !== 'GET' && request.method !== 'HEAD';
      if (isWrite && response.status < 400) {
        // Coarse activity-log fallback (server/services/audit.ts): entityType is unknown at this
        // generic layer, so this is only ever a `mutation` row — `crud()`'s `entity` option, or a
        // service's own precise `record()` call, is what upgrades a route past this.
        noteAction(request.method, opts?.live ?? null, response.status);
        if (!hasCrudEntry()) {
          record({ action: COARSE_ACTION_FOR_METHOD[request.method] ?? 'mutation' });
        }
        if (opts?.live) notifyLive(env, execCtx, opts.live);
      }
      return response;
    } catch (err) {
      if (err instanceof Response) return err;
      console.error('[api] unhandled', { path: new URL(request.url).pathname, err: String(err) });
      return fail('internal_error', 500);
    }
  };
}

/** Same as withAuth but for unauthenticated endpoints (login, invite redemption, reset). */
export function withPublic<T>(
  handler: (ctx: Omit<ApiCtx, 'user'>) => Promise<T>,
): (args: LoaderFunctionArgs | ActionFunctionArgs) => Promise<Response> {
  return async ({ request, params, context }) => {
    if (request.method === 'OPTIONS') return corsPreflight();
    const { env, ctx: execCtx } = context.get(cloudflareCtx);
    try {
      const result = await handler({
        db: createDb(env),
        env,
        ctx: execCtx,
        request,
        params: params as Record<string, string | undefined>,
      });
      return result instanceof Response ? result : ok(result);
    } catch (err) {
      if (err instanceof Response) return err;
      console.error('[api] unhandled', { path: new URL(request.url).pathname, err: String(err) });
      return fail('internal_error', 500);
    }
  };
}

/**
 * Parse a JSON body against a Zod schema.
 * @throws {Response} 422 `{ error: 'validation_failed', issues }` — or 400 on malformed JSON.
 */
export async function parseBody<S extends z.ZodType>(
  request: Request,
  schema: S,
): Promise<z.infer<S>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw fail('invalid_json', 400);
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) throw fail('validation_failed', 422, parsed.error.issues);
  return parsed.data;
}

/**
 * Parse a PARTIAL body for PATCH.
 *
 * Uses parsePatch rather than schema.partial() because Zod still applies `.default()` for
 * absent keys, which would silently overwrite columns the caller never mentioned — e.g.
 * toggling `favorite` resetting `type` to its default. See shared/schemas.ts:3-8.
 */
export async function parsePatchBody<S extends z.ZodObject<z.ZodRawShape>>(
  request: Request,
  schema: S,
): Promise<Partial<z.infer<S>>> {
  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    throw fail('invalid_json', 400);
  }
  if (typeof raw !== 'object' || raw === null) throw fail('validation_failed', 422);
  const parsed = parsePatch(schema, raw as Record<string, unknown>);
  if (!parsed.success) throw fail('validation_failed', 422, parsed.error.issues);
  return parsed.data;
}

/** Require a path or query param, else 400. */
export function requireId(ctx: ApiCtx): string {
  const id = ctx.params.id ?? new URL(ctx.request.url).searchParams.get('id');
  if (!id) throw fail('missing_id', 400);
  return id;
}

type CrudCfg<S extends z.ZodObject<z.ZodRawShape>> = {
  level: AuthLevel;
  /** GET may be looser than writes — e.g. flashcard topics are readable by students. */
  readLevel?: AuthLevel;
  schema: S;
  /** Domain broadcast to web clients after a successful write (see server/live.ts). */
  live?: MutationDomain;
  /**
   * Activity-log entity for this collection (server/services/audit.ts). When set, PATCH/DELETE
   * pre-read the row by id for a `before` snapshot and POST/PATCH use the handler's return value
   * as `after` — full before/after for the mobile API with zero changes to the service functions
   * themselves. Omit for a service that already calls `recordCreate`/`record`/`recordDelete`
   * itself (people/events/classes/materials) — `hasCrudEntry()` below makes this a no-op there
   * anyway, but the extra pre-read is a needless D1 read.
   */
  entity?: { type: string; table: TableWithId };
  list: (ctx: ApiCtx) => Promise<unknown>;
  create?: (input: z.infer<S>, ctx: ApiCtx) => Promise<unknown>;
  update?: (id: string, patch: Partial<z.infer<S>>, ctx: ApiCtx) => Promise<unknown>;
  remove?: (id: string, ctx: ApiCtx) => Promise<unknown>;
};

async function readByIdOrUndefined(
  db: ApiCtx['db'],
  table: TableWithId,
  id: string,
): Promise<Record<string, unknown> | undefined> {
  const rows = await db.select().from(table).where(eq(table.id, id)).limit(1);
  return rows[0] as Record<string, unknown> | undefined;
}

/**
 * Build the standard collection route: GET list, POST create, PATCH update, DELETE remove.
 * PATCH/DELETE take the id from `:id` or `?id=`, so one factory serves both
 * `/api/things` and `/api/things/:id`.
 */
export function crud<S extends z.ZodObject<z.ZodRawShape>>(cfg: CrudCfg<S>) {
  const loader = withAuth(cfg.readLevel ?? cfg.level, (ctx) => cfg.list(ctx));

  const action = withAuth(
    cfg.level,
    async (ctx) => {
      switch (ctx.request.method) {
        case 'POST': {
          if (!cfg.create) throw fail('method_not_allowed', 405);
          const result = await cfg.create(await parseBody(ctx.request, cfg.schema), ctx);
          if (cfg.entity && !hasCrudEntry()) {
            const row = result as { id?: string } | undefined;
            if (row?.id) recordCreate(cfg.entity.type, row.id, row);
          }
          return result;
        }
        case 'PATCH': {
          if (!cfg.update) throw fail('method_not_allowed', 405);
          const id = requireId(ctx);
          const before =
            cfg.entity && !hasCrudEntry()
              ? await readByIdOrUndefined(ctx.db, cfg.entity.table, id)
              : undefined;
          const patch = await parsePatchBody(ctx.request, cfg.schema);
          const result = await cfg.update(id, patch, ctx);
          if (cfg.entity && before !== undefined && !hasCrudEntry()) {
            record({
              action: 'update',
              entityType: cfg.entity.type,
              entityId: id,
              before,
              after: result,
            });
          }
          return result;
        }
        case 'DELETE': {
          if (!cfg.remove) throw fail('method_not_allowed', 405);
          const id = requireId(ctx);
          if (cfg.entity && !hasCrudEntry()) {
            await recordDelete(ctx.db, cfg.entity.type, cfg.entity.table, id);
          }
          return cfg.remove(id, ctx);
        }
        default:
          throw fail('method_not_allowed', 405);
      }
    },
    { live: cfg.live },
  );

  return { loader, action };
}
