import Constants from 'expo-constants';

/**
 * The only place in the app that talks HTTP.
 *
 * Contract: docs/api.md. Every 2xx is `{ data: … }`; every failure is `{ error, issues? }`.
 * Auth is `Authorization: Bearer <token>`, never a cookie — React Native has no cookie jar.
 */

/**
 * EXPO_PUBLIC_* is INLINED INTO THE BUNDLE at build time and is therefore public. A base URL
 * is fine; a secret would not be. Never put one here.
 *
 * The `typeof` guard is load-bearing. `eas update` evaluates app.config.ts with whatever env
 * the EAS "environment" provides — publish without EXPO_PUBLIC_API_URL there and `extra.apiUrl`
 * arrives as `{}`, and `{}.replace` threw BEFORE THE FIRST FRAME. A pre-frame crash in an OTA
 * bundle is the worst kind: expo-updates' error recovery silently rolls back to the previous
 * bundle, so the update looks like it never arrived (2026-07-29; an hour of logcat to find).
 * With the guard the app boots with BASE='' and every API call fails visibly instead.
 */
const rawExtraApiUrl = (Constants.expoConfig?.extra as { apiUrl?: unknown } | undefined)?.apiUrl;
export const BASE = (
  process.env.EXPO_PUBLIC_API_URL ?? (typeof rawExtraApiUrl === 'string' ? rawExtraApiUrl : '')
).replace(/\/$/, '');

/** ~15s. Vietnamese mobile connections drop silently; a fetch with no timeout is a frozen screen. */
const TIMEOUT_MS = 15_000;

export class ApiError extends Error {
  constructor(
    public status: number,
    /** The machine-readable `error` code from the envelope, e.g. `validation_failed`. */
    public code: string,
    /** An i18n key describing the failure, ready to pass to `t()`. */
    public messageKey: string,
    public issues?: unknown,
  ) {
    super(`${status} ${code}`);
    this.name = 'ApiError';
  }
}

/** Maps a transport or envelope failure onto a string the user can act on. */
function messageKeyFor(status: number, code: string): string {
  if (status === 401) return 'm_session_expired';
  if (status === 403) return 'err_forbidden_msg';
  if (status === 404) return 'err_not_found_msg';
  if (status === 0) return code === 'timeout' ? 'm_timeout' : 'm_offline';
  if (status >= 500) return 'm_server_error';
  return 'err_generic_msg';
}

type TokenReader = () => Promise<string | null>;
type UnauthorizedHandler = () => void;

let readToken: TokenReader = async () => null;
let onUnauthorized: UnauthorizedHandler = () => {};

/**
 * Wired once, by AuthProvider. The API client owns the 401 response for the WHOLE app — every
 * screen gets correct session-expiry behavior without writing a line for it, and there is
 * exactly one place where "signed out" can happen.
 */
export function configureApi(opts: { getToken: TokenReader; onUnauthorized: UnauthorizedHandler }) {
  readToken = opts.getToken;
  onUnauthorized = opts.onUnauthorized;
}

export interface ApiInit extends Omit<RequestInit, 'body'> {
  /** Set false for the login / redeem / request-reset endpoints. Defaults to true. */
  auth?: boolean;
  /** A plain object is JSON-encoded; FormData is passed straight through. */
  body?: unknown;
  /** Appended as a query string, skipping null/undefined. */
  query?: Record<string, string | number | boolean | null | undefined>;
  /**
   * Raises the default 15s timeout for a call that is legitimately slower — currently only AI
   * vocab generation, where the model takes 5-20s. Do not use it to paper over a slow endpoint:
   * a long timeout on an ordinary call is a frozen screen.
   */
  timeoutMs?: number;
}

function buildUrl(path: string, query?: ApiInit['query']): string {
  const url = `${BASE}${path.startsWith('/') ? path : `/${path}`}`;
  if (!query) return url;
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query)) {
    if (v !== null && v !== undefined) qs.set(k, String(v));
  }
  const s = qs.toString();
  return s ? `${url}?${s}` : url;
}

/**
 * A multipart upload that reports progress.
 *
 * `fetch` cannot do this — the Fetch standard has no upload-progress event, and React Native's
 * polyfill is no exception. `XMLHttpRequest.upload.onprogress` does, and React Native implements
 * it, so this is the one place in the app that does not go through `apiFetch`. It keeps the same
 * contract: bearer auth, the `{ data }` / `{ error }` envelope, and the shared 401 handling.
 *
 * The 15-second timeout does NOT apply here. A 20 MB worksheet over Vietnamese mobile data can
 * legitimately take a minute, and aborting a nearly-complete upload is worse than waiting.
 */
export async function apiUpload<T>(
  path: string,
  form: FormData,
  opts: {
    method?: 'POST' | 'PATCH';
    query?: ApiInit['query'];
    onProgress?: (pct: number) => void;
  } = {},
): Promise<T> {
  if (!BASE) throw new ApiError(0, 'no_base_url', 'm_server_error');
  const token = await readToken();

  return new Promise<T>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open(opts.method ?? 'POST', buildUrl(path, opts.query));
    xhr.setRequestHeader('Accept', 'application/json');
    if (token) xhr.setRequestHeader('Authorization', `Bearer ${token}`);
    // No Content-Type: XHR derives the multipart boundary from the FormData, exactly as with
    // fetch. Setting it by hand omits the boundary and the server sees a malformed body.

    if (opts.onProgress) {
      xhr.upload.onprogress = (e) => {
        // `lengthComputable` is false for a stream of unknown size; reporting 0 forever is worse
        // than an indeterminate bar, so the caller gets -1 and can decide.
        opts.onProgress!(e.lengthComputable ? Math.round((e.loaded / e.total) * 100) : -1);
      };
    }

    xhr.onerror = () => reject(new ApiError(0, 'network_error', messageKeyFor(0, 'network_error')));
    xhr.onabort = () => reject(new ApiError(0, 'aborted', messageKeyFor(0, 'network_error')));

    xhr.onload = () => {
      let parsed: unknown = undefined;
      if (xhr.responseText) {
        try {
          parsed = JSON.parse(xhr.responseText);
        } catch {
          reject(new ApiError(xhr.status || 500, 'non_json_response', 'm_server_error'));
          return;
        }
      }
      if (xhr.status < 200 || xhr.status >= 300) {
        const env = (parsed ?? {}) as { error?: string; issues?: unknown };
        const code = env.error ?? `http_${xhr.status}`;
        if (xhr.status === 401) onUnauthorized();
        reject(new ApiError(xhr.status, code, messageKeyFor(xhr.status, code), env.issues));
        return;
      }
      resolve(((parsed ?? {}) as { data?: T }).data as T);
    };

    xhr.send(form as unknown as Document);
  });
}

export async function apiFetch<T>(path: string, init: ApiInit = {}): Promise<T> {
  const { auth = true, body, query, headers, timeoutMs, ...rest } = init;

  if (!BASE) {
    throw new ApiError(0, 'no_base_url', 'm_server_error');
  }

  const isForm = typeof FormData !== 'undefined' && body instanceof FormData;
  const h: Record<string, string> = { Accept: 'application/json', ...(headers as object) };

  // Do NOT set Content-Type for FormData. React Native must generate the multipart boundary
  // itself; setting the header by hand omits it and the server sees a malformed body.
  if (body !== undefined && !isForm) h['Content-Type'] = 'application/json';

  if (auth) {
    const token = await readToken();
    if (token) h.Authorization = `Bearer ${token}`;
  }

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs ?? TIMEOUT_MS);

  let res: Response;
  try {
    res = await fetch(buildUrl(path, query), {
      ...rest,
      headers: h,
      body: body === undefined ? undefined : isForm ? (body as FormData) : JSON.stringify(body),
      signal: controller.signal,
    });
  } catch (err) {
    // An aborted fetch and a dead network are indistinguishable to the caller otherwise, and
    // they need different messages: "too slow" vs "you are offline".
    const timedOut = err instanceof Error && err.name === 'AbortError';
    throw new ApiError(
      0,
      timedOut ? 'timeout' : 'network_error',
      messageKeyFor(0, timedOut ? 'timeout' : 'network_error'),
    );
  } finally {
    clearTimeout(timer);
  }

  // 204 and friends have no body to unwrap.
  const raw = res.status === 204 ? '' : await res.text();
  let parsed: unknown = undefined;
  if (raw) {
    try {
      parsed = JSON.parse(raw);
    } catch {
      // The API always returns JSON. HTML here means we hit the SSR shell rather than a
      // resource route — a routing bug, not a user error. Surface it as a 500-ish.
      throw new ApiError(res.status || 500, 'non_json_response', 'm_server_error');
    }
  }

  if (!res.ok) {
    const env = (parsed ?? {}) as { error?: string; issues?: unknown };
    const code = env.error ?? `http_${res.status}`;
    // One place, for the whole app: an expired or revoked token clears the session and sends
    // the user to /login. 401 ONLY — a 403 means the token is valid and the role is wrong, and
    // signing the user out for that would be both wrong and baffling.
    if (res.status === 401) onUnauthorized();
    throw new ApiError(res.status, code, messageKeyFor(res.status, code), env.issues);
  }

  return ((parsed ?? {}) as { data?: T }).data as T;
}
