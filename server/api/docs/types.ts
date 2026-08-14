import type { z } from 'zod';

/**
 * The metadata that describes the JSON API to `build-spec.ts`.
 *
 * Everything here is deliberately free of runtime imports beyond Zod. `registry.ts` is loaded by
 * the Worker, by node vitest and by the completeness test, so it must never reach into
 * `server/services/*` or a route file — those pull in Drizzle, the Anthropic SDK and the audit
 * store, and one of them acquiring a `cloudflare:` import would break spec generation everywhere.
 */

/**
 * Mirrors `AuthLevel` in `server/api/handler.ts`, plus the two cases that live outside the ladder:
 * `public` for `withPublic` routes, and `webhook-secret` for the Zalo webhook, which authenticates
 * on a shared header because Zalo's servers have no session.
 *
 * Declared here rather than imported so this module stays import-safe. `test/api-contract.test.ts`
 * asserts the two stay in step.
 */
export type DocAuthLevel =
  'any' | 'user' | 'parent' | 'staff' | 'admin' | 'public' | 'webhook-secret';

export type ParamDoc = {
  name: string;
  in: 'query' | 'path';
  required?: boolean;
  /** Omit for a plain string. */
  schema?: z.ZodType;
  description?: string;
};

export type ResponseDoc = {
  /** The BARE payload. The builder wraps 2xx in the `{ data }` envelope; errors use ErrorEnvelope. */
  schema?: z.ZodType;
  description: string;
};

export type RequestDoc = {
  schema?: z.ZodType;
  contentType?: 'application/json' | 'multipart/form-data';
  /**
   * Render the schema as a partial and explain `parsePatch` semantics: keys the caller omits are
   * left untouched, and — unlike Zod's own `.partial()` — their defaults are NOT applied.
   */
  patch?: boolean;
  /** Hand-written JSON Schema, for bodies Zod cannot describe (the multipart upload). */
  rawBody?: Record<string, unknown>;
};

export type OperationDoc = {
  method: 'get' | 'post' | 'patch' | 'put' | 'delete';
  summary: string;
  description?: string;
  auth: DocAuthLevel;
  params?: ParamDoc[];
  request?: RequestDoc;
  /** Keyed by status. The builder adds 401/403 from `auth` and 400/422 from `request`. */
  responses: Record<number, ResponseDoc>;
};

export type PathDoc = {
  /** OpenAPI path, e.g. `/api/events/{id}`. */
  path: string;
  /**
   * The EXACT first argument of this route's `route()` call in `app/routes.ts`.
   * `test/api-docs-completeness.test.ts` compares these two sets and fails on any difference,
   * which is what stops a new endpoint from shipping undocumented.
   */
  routePattern: string;
  tag: string;
  operations: OperationDoc[];
};
