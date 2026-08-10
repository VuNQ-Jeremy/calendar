import type { z } from 'zod';
import type { ActionFunctionArgs, LoaderFunctionArgs } from 'react-router';
import { createDb, type Db } from '../db';
import { cloudflareCtx } from '../../app/load-context';
import { parsePatch } from '../../shared/schemas';
import type { SessionUser, LearnerUser } from '../services/auth';
import { requireApiUser, requireApiLearner, requireApiStaff, requireApiAdmin } from './auth';
import { notifyLive } from '../live';
import type { MutationDomain } from '../../shared/live';

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
 */
export type AuthLevel = 'any' | 'user' | 'staff' | 'admin';

/**
 * Every level except 'any' has already turned parents away, so a handler at those levels
 * gets the narrowed session the flashcard and garden services require.
 */
type UserFor<L extends AuthLevel> = L extends 'any' ? SessionUser : LearnerUser;

export type ApiCtx<L extends AuthLevel = AuthLevel> = {
  user: UserFor<L>;
  db: Db;
  env: Env;
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
        request,
        params: params as Record<string, string | undefined>,
      });
      const response = result instanceof Response ? result : ok(result);
      if (
        opts?.live &&
        request.method !== 'GET' &&
        request.method !== 'HEAD' &&
        response.status < 400
      ) {
        notifyLive(env, execCtx, opts.live);
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
    const env = context.get(cloudflareCtx).env;
    try {
      const result = await handler({
        db: createDb(env),
        env,
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
  list: (ctx: ApiCtx) => Promise<unknown>;
  create?: (input: z.infer<S>, ctx: ApiCtx) => Promise<unknown>;
  update?: (id: string, patch: Partial<z.infer<S>>, ctx: ApiCtx) => Promise<unknown>;
  remove?: (id: string, ctx: ApiCtx) => Promise<unknown>;
};

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
          return cfg.create(await parseBody(ctx.request, cfg.schema), ctx);
        }
        case 'PATCH': {
          if (!cfg.update) throw fail('method_not_allowed', 405);
          const id = requireId(ctx);
          return cfg.update(id, await parsePatchBody(ctx.request, cfg.schema), ctx);
        }
        case 'DELETE': {
          if (!cfg.remove) throw fail('method_not_allowed', 405);
          return cfg.remove(requireId(ctx), ctx);
        }
        default:
          throw fail('method_not_allowed', 405);
      }
    },
    { live: cfg.live },
  );

  return { loader, action };
}
