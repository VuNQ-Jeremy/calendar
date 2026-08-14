import { describe, expect, it } from 'vitest';
import { buildSpec } from '../server/api/docs/build-spec';

/**
 * Structural checks on the generated OpenAPI document.
 *
 * The spec is assembled at request time from Zod schemas, so nobody reviews it before it ships —
 * these assertions are the review. They are the reason `z.toJSONSchema` can be trusted with a
 * schema file that keeps growing: an unrepresentable type turns into an empty `{}` or a dangling
 * `$ref`, and both fail here rather than in a reader's browser.
 */

type Json = Record<string, any>;

const spec = buildSpec('https://example.test') as Json;

const operations = (): { path: string; method: string; op: Json }[] => {
  const out: { path: string; method: string; op: Json }[] = [];
  for (const [path, item] of Object.entries(spec.paths as Record<string, Json>)) {
    for (const [method, op] of Object.entries(item)) {
      out.push({ path, method, op: op as Json });
    }
  }
  return out;
};

const refs = (node: unknown, found: string[] = []): string[] => {
  if (Array.isArray(node)) {
    node.forEach((n) => refs(n, found));
  } else if (node && typeof node === 'object') {
    for (const [k, v] of Object.entries(node)) {
      if (k === '$ref' && typeof v === 'string') found.push(v);
      else refs(v, found);
    }
  }
  return found;
};

describe('the document', () => {
  it('is OpenAPI 3.1', () => {
    // 3.1 and not 3.0: the schemas are emitted as JSON Schema 2020-12, which only 3.1 accepts.
    expect(spec.openapi).toMatch(/^3\.1\./);
  });

  it('serializes', () => {
    expect(() => JSON.parse(JSON.stringify(spec))).not.toThrow();
  });

  it('describes the whole surface', () => {
    expect(Object.keys(spec.paths).length).toBeGreaterThan(70);
    expect(operations().length).toBeGreaterThan(120);
  });

  it('declares both security schemes', () => {
    expect(spec.components.securitySchemes.bearerAuth).toMatchObject({
      type: 'http',
      scheme: 'bearer',
    });
    expect(spec.components.securitySchemes.zaloWebhookSecret).toMatchObject({
      in: 'header',
      name: 'X-Bot-Api-Secret-Token',
    });
  });

  it('lists every tag it uses', () => {
    const declared = new Set((spec.tags as Json[]).map((t) => t.name));
    const used = new Set(operations().flatMap(({ op }) => op.tags as string[]));
    expect([...used].filter((t) => !declared.has(t))).toEqual([]);
  });

  it('describes every tag', () => {
    // Scalar renders these under each section heading, so a bare tag is a blank section intro.
    const bare = (spec.tags as Json[]).filter((t) => !t.description).map((t) => t.name);
    expect(bare, 'Add a description in TAGS (server/api/docs/registry.ts)').toEqual([]);
  });
});

describe('schemas', () => {
  it('resolves every $ref', () => {
    const ids = new Set(Object.keys(spec.components.schemas));
    const dangling = [...new Set(refs(spec))]
      .filter((r) => !ids.has(r.replace('#/components/schemas/', '')))
      .sort();
    expect(dangling, 'A $ref points at a schema that was never emitted').toEqual([]);
  });

  it('emits no empty component', () => {
    // An empty object is what `z.toJSONSchema` produces for something it cannot represent. It
    // validates as "anything", so it would silently document a payload as unconstrained.
    const empty = Object.entries(spec.components.schemas as Record<string, Json>)
      .filter(([, s]) => Object.keys(s).length === 0)
      .map(([id]) => id);
    expect(empty).toEqual([]);
  });

  it('leaves no local $defs behind', () => {
    // Zod hoists reused schemas into a local `$defs`; the builder repoints those at
    // `components.schemas`. A leftover block means that rewrite missed a case.
    expect(refs(spec).filter((r) => r.startsWith('#/$defs/'))).toEqual([]);
  });
});

describe('every operation', () => {
  it('has a summary and a unique operationId', () => {
    const ids = new Map<string, number>();
    for (const { path, method, op } of operations()) {
      expect(op.summary, `${method} ${path}`).toBeTruthy();
      ids.set(op.operationId, (ids.get(op.operationId) ?? 0) + 1);
    }
    expect([...ids].filter(([, n]) => n > 1).map(([id]) => id)).toEqual([]);
  });

  it('documents an outcome — a 2xx, or an explicit 405', () => {
    const bad = operations()
      .filter(({ op }) => {
        const codes = Object.keys(op.responses);
        // `PATCH /api/invites/{id}` is documented purely to say the verb is not served.
        return !codes.some((c) => c.startsWith('2')) && !codes.includes('405');
      })
      .map(({ path, method }) => `${method} ${path}`);
    expect(bad).toEqual([]);
  });

  it('wraps every 2xx payload in the { data } envelope', () => {
    const bare = operations()
      .flatMap(({ path, method, op }) =>
        Object.entries(op.responses as Record<string, Json>)
          .filter(([code]) => code.startsWith('2'))
          .filter(([, res]) => {
            const schema = res.content?.['application/json']?.schema;
            return !schema?.properties?.data;
          })
          .map(([code]) => `${method} ${path} -> ${code}`),
      )
      .sort();
    expect(bare).toEqual([]);
  });

  it('answers 401 wherever a token is required, and never where it is not', () => {
    const wrong: string[] = [];
    for (const { path, method, op } of operations()) {
      const codes = Object.keys(op.responses);
      const isPublic = Array.isArray(op.security) && op.security.length === 0;
      if (isPublic && codes.includes('401') && !path.includes('/auth/')) {
        wrong.push(`${method} ${path} is public but documents a 401`);
      }
      const usesBearer = op.security?.[0]?.bearerAuth !== undefined;
      if (usesBearer && !codes.includes('401')) {
        wrong.push(`${method} ${path} needs a token but documents no 401`);
      }
    }
    expect(wrong).toEqual([]);
  });

  it('describes every error response with the shared envelope', () => {
    const wrong = operations()
      .flatMap(({ path, method, op }) =>
        Object.entries(op.responses as Record<string, Json>)
          .filter(([code]) => Number(code) >= 400)
          .filter(
            ([, res]) =>
              res.content?.['application/json']?.schema?.$ref !==
              '#/components/schemas/ErrorEnvelope',
          )
          .map(([code]) => `${method} ${path} -> ${code}`),
      )
      .sort();
    expect(wrong).toEqual([]);
  });
});

describe('PATCH bodies', () => {
  it('makes every field optional', () => {
    // parsePatch (shared/schemas.ts) drops keys the caller did not send, so no field is required
    // and no default is applied. A `required` array here would document the opposite.
    const wrong = operations()
      .filter(({ method }) => method === 'patch')
      .filter(({ op }) => {
        const schema = op.requestBody?.content?.['application/json']?.schema;
        return schema?.required !== undefined;
      })
      .map(({ path, method }) => `${method} ${path}`);
    expect(wrong).toEqual([]);
  });
});
