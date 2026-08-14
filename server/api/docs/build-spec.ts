import { z } from 'zod';
// Load-bearing side effect, not a stray import: `.meta({ id })` registers a schema in
// `z.globalRegistry`, and `components()` below emits that registry. Without this, a response
// schema that no registry entry happens to name directly would never become a component.
import '../../../shared/api-contract';
import { registry, TAGS } from './registry';
import type { DocAuthLevel, OperationDoc, ParamDoc, PathDoc } from './types';

/**
 * Assemble the OpenAPI 3.1 document from `registry.ts` and the Zod schemas it points at.
 *
 * There is no build step and no checked-in artefact: the document is derived from the same
 * schemas the handlers validate with, on the first request that asks for it, and cached in
 * module scope for the life of the isolate. That is the whole point — a generated file would
 * start drifting the first time someone forgot to regenerate it.
 *
 * Served (staff-only) by `app/routes/docs.openapi.tsx` and rendered by `app/routes/docs.api.tsx`.
 */

type Json = Record<string, unknown>;

/** Levels that mean "a bearer token must be present". */
const NEEDS_TOKEN: DocAuthLevel[] = ['any', 'user', 'parent', 'staff', 'admin'];

/** Levels that can also refuse a perfectly valid token because of who is holding it. */
const CAN_403: DocAuthLevel[] = ['user', 'parent', 'staff', 'admin'];

const WHO: Record<string, string> = {
  any: 'Any signed-in account, parents included.',
  user: 'Staff or students. Parents are refused.',
  parent: 'Parents only. Staff and students are refused.',
  staff: 'Staff of any role.',
  admin: 'Admins only.',
};

/**
 * Point every `$ref` at `components.schemas`.
 *
 * Converting a schema that merely CONTAINS registered ones — `z.array(EventRow)`, say — makes Zod
 * hoist each into a local `$defs` and reference it there. Those ids are by definition already in
 * `components.schemas` (that is what being registered means), so the local copies are redundant:
 * repoint the refs and drop the block. Anything Zod hoisted that is somehow NOT a component is
 * collected in `strays` and merged in at the end rather than left dangling.
 */
const strays = new Map<string, Json>();

function repoint(node: unknown): void {
  if (Array.isArray(node)) return node.forEach(repoint);
  if (!node || typeof node !== 'object') return;
  const obj = node as Json;
  if (typeof obj.$ref === 'string' && obj.$ref.startsWith('#/$defs/')) {
    obj.$ref = `#/components/schemas/${obj.$ref.slice('#/$defs/'.length)}`;
  }
  for (const v of Object.values(obj)) repoint(v);
}

/**
 * Convert one schema. Schemas carrying `.meta({ id })` — everything in `shared/api-contract.ts` —
 * come back as a `$ref` into `components.schemas`; anything else is inlined.
 */
function convert(schema: z.ZodType, io: 'input' | 'output'): Json {
  const id = (schema.meta() as { id?: string } | undefined)?.id;
  if (id && io === 'output') return { $ref: `#/components/schemas/${id}` };

  const out = z.toJSONSchema(schema, { io, unrepresentable: 'any' }) as Json;
  delete out.$schema;
  delete out.$id;

  const defs = out.$defs as Record<string, Json> | undefined;
  if (defs) {
    delete out.$defs;
    for (const [defId, def] of Object.entries(defs)) {
      const copy = { ...def };
      delete copy.$schema;
      delete copy.$id;
      repoint(copy);
      strays.set(defId, copy);
    }
  }
  repoint(out);
  return out;
}

/** Every `.meta({ id })` schema, emitted once with `$ref`s between them. */
function components(): Json {
  const bundle = z.toJSONSchema(z.globalRegistry, {
    uri: (id) => `#/components/schemas/${id}`,
    io: 'output',
    unrepresentable: 'any',
  }) as { schemas: Record<string, Json> };

  const schemas: Json = {};
  for (const [id, raw] of Object.entries(bundle.schemas)) {
    const s = { ...raw };
    delete s.$schema;
    delete s.$id;
    schemas[id] = s;
  }
  return schemas;
}

function parameters(params: ParamDoc[] | undefined): Json[] {
  return (params ?? []).map((p) => ({
    name: p.name,
    in: p.in,
    required: p.in === 'path' ? true : Boolean(p.required),
    ...(p.description ? { description: p.description } : {}),
    schema: p.schema ? convert(p.schema, 'input') : { type: 'string' },
  }));
}

function requestBody(op: OperationDoc): Json | undefined {
  const req = op.request;
  if (!req) return undefined;

  if (req.rawBody) {
    return {
      required: true,
      content: { [req.contentType ?? 'application/json']: { schema: req.rawBody } },
    };
  }
  if (!req.schema) return undefined;

  const schema = convert(req.schema, 'input');
  if (req.patch) {
    // A PATCH body is every field, all optional. Zod's own `.partial()` would still apply
    // defaults for absent keys — `parsePatch` in shared/schemas.ts strips them back out, which
    // is what makes "omit a field to leave it alone" true. Reflect that here.
    delete schema.required;
  }
  return {
    required: true,
    description: req.patch
      ? 'Send only the fields you are changing. Anything you omit is left untouched — and unlike ' +
        'a plain Zod partial, its default is NOT applied.'
      : undefined,
    content: { [req.contentType ?? 'application/json']: { schema } },
  };
}

const errorResponse = (description: string): Json => ({
  description,
  content: { 'application/json': { schema: { $ref: '#/components/schemas/ErrorEnvelope' } } },
});

function responses(op: OperationDoc): Json {
  const out: Json = {};

  for (const [status, doc] of Object.entries(op.responses)) {
    const code = Number(status);
    if (code >= 400) {
      out[status] = errorResponse(doc.description);
      continue;
    }
    out[status] = {
      description: doc.description,
      content: {
        'application/json': {
          schema: doc.schema
            ? {
                type: 'object',
                properties: { data: convert(doc.schema, 'output') },
                required: ['data'],
              }
            : { type: 'object', properties: { data: {} }, required: ['data'] },
        },
      },
    };
  }

  // The uniform failures, added here so no registry entry has to repeat them.
  if (op.request && !out['400']) {
    out['400'] = errorResponse('`invalid_json` — the body was not parseable JSON.');
  }
  if (op.request && !out['422']) {
    out['422'] = errorResponse(
      '`validation_failed` — the body failed Zod validation. `issues` carries the Zod issue array.',
    );
  }
  if (NEEDS_TOKEN.includes(op.auth) && !out['401']) {
    out['401'] = errorResponse('`unauthorized` — missing, unknown or expired token.');
  }
  if (CAN_403.includes(op.auth) && !out['403']) {
    out['403'] = errorResponse(`\`forbidden\` — ${WHO[op.auth] ?? 'wrong role.'}`);
  }
  if (!out['500']) {
    out['500'] = errorResponse(
      '`internal_error` — unhandled. The detail is logged server-side, never returned.',
    );
  }
  return out;
}

function operation(op: OperationDoc, tag: string, path: string): Json {
  const security =
    op.auth === 'public'
      ? []
      : op.auth === 'webhook-secret'
        ? [{ zaloWebhookSecret: [] }]
        : [{ bearerAuth: [] }];

  const notes: string[] = [];
  if (op.description) notes.push(op.description);
  if (WHO[op.auth]) notes.push(`**Who may call this:** ${WHO[op.auth]}`);
  if (op.auth === 'public') notes.push('**Who may call this:** anyone — no token needed.');

  return {
    tags: [tag],
    summary: op.summary,
    ...(notes.length ? { description: notes.join('\n\n') } : {}),
    operationId: `${op.method}${path.replace(/[/{}]/g, '_')}`,
    security,
    ...(op.params?.length ? { parameters: parameters(op.params) } : {}),
    ...(requestBody(op) ? { requestBody: requestBody(op) } : {}),
    responses: responses(op),
  };
}

function paths(): Json {
  const out: Json = {};
  for (const entry of registry as PathDoc[]) {
    const item = (out[entry.path] ?? {}) as Json;
    for (const op of entry.operations) {
      item[op.method] = operation(op, entry.tag, entry.path);
    }
    out[entry.path] = item;
  }
  return out;
}

function tags(): Json[] {
  const present = new Set(registry.map((r) => r.tag));
  const described = TAGS.filter((t) => present.has(t.name));
  // A tag someone adds to an entry without describing it still renders, just bare.
  const named = new Set(TAGS.map((t) => t.name));
  const rest = [...present]
    .filter((t) => !named.has(t))
    .sort()
    .map((name) => ({ name }));
  return [...described, ...rest];
}

export function buildSpec(origin: string): Json {
  strays.clear();
  // Order matters: `paths()` is what populates `strays`, so it has to run before the merge below.
  const built = paths();
  const schemas = components();
  for (const [id, schema] of strays) if (!(id in schemas)) schemas[id] = schema;

  return {
    openapi: '3.1.0',
    info: {
      title: 'Mochi JSON API',
      version: '1.0.0',
      description:
        'The API the Mochi mobile app talks to.\n\n' +
        'It sits **alongside** the web app’s React Router loaders and actions, not instead of ' +
        'them: both call the same `server/services/*` functions and validate with the same Zod ' +
        'schemas, so the two clients cannot drift apart.\n\n' +
        '**Envelope.** Every success is `{ "data": … }` and every failure is `{ "error": … }`, ' +
        'with an `issues` array on `validation_failed`. The schemas below show the wrapped form.\n\n' +
        '**The API never redirects.** The web guards throw a redirect to `/login`; these throw ' +
        'JSON, because a native client cannot meaningfully follow a 302 to an HTML page.\n\n' +
        '**Auth is `Authorization: Bearer` only** — never a cookie. Get a token from ' +
        '`POST /api/auth/login`, then paste it into Authorize above to use Test Request.\n\n' +
        'Narrative documentation — idempotency, the garden rules, the Zalo channel — lives in ' +
        '`docs/api.md`. This page is the endpoint reference, generated from the code itself.',
    },
    servers: [{ url: origin }],
    tags: tags(),
    paths: built,
    components: {
      schemas,
      securitySchemes: {
        bearerAuth: {
          type: 'http',
          scheme: 'bearer',
          description: 'The raw token from `POST /api/auth/login`.',
        },
        zaloWebhookSecret: {
          type: 'apiKey',
          in: 'header',
          name: 'X-Bot-Api-Secret-Token',
          description: 'The shared secret Zalo’s servers send. Not a user credential.',
        },
      },
    },
  };
}

let cached: string | null = null;

/**
 * The spec as JSON text. Built once per isolate — the first caller pays a few milliseconds and
 * everyone after it is free. The origin is baked in on that first call, which is fine: one
 * deployment only ever serves one origin.
 */
export function getSpecJson(origin: string): string {
  if (cached === null) cached = JSON.stringify(buildSpec(origin));
  return cached;
}
