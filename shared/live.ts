/**
 * Live-update wire protocol.
 *
 * Shared by the three sides of the feature so the domain list cannot drift:
 *   - workers/live-hub.ts   the Durable Object that fans messages out
 *   - server/live.ts        the broadcast helper called from route actions
 *   - src/lib/live.ts       the browser client that turns messages into
 *                           cache invalidations
 *
 * A message carries only a domain name — never row data. Clients re-fetch
 * through their normal loaders, so D1 stays the single source of truth and no
 * authorisation logic has to be duplicated into the socket layer.
 */

export const MUTATION_DOMAINS = [
  'calendar',
  'classes',
  'people',
  'materials',
  'assessments',
  'flashcards',
  'questions',
  'tests',
  'config',
  'feedback',
  'profile',
  'attendance',
] as const;

export type MutationDomain = (typeof MUTATION_DOMAINS)[number];

export function isMutationDomain(value: unknown): value is MutationDomain {
  return typeof value === 'string' && (MUTATION_DOMAINS as readonly string[]).includes(value);
}

/**
 * Domains a student socket is allowed to receive; staff receive everything.
 *
 * Students only have /vocabulary and /my-tests, which react to exactly these
 * two domains. The rest describe staff-only tables — a bare domain name leaks
 * little, but there is no reason to tell a student session that someone is
 * editing the people list.
 */
export const STUDENT_LIVE_DOMAINS: ReadonlySet<MutationDomain> = new Set(['flashcards', 'tests']);

export type LiveInvalidateMsg = {
  type: 'invalidate';
  domain: MutationDomain;
  ts: number;
};
