import { DurableObject } from 'cloudflare:workers';

/**
 * Fixed-window request counter, one instance per rate-limit key.
 *
 * Replaces Cloudflare's native rate limiting binding, which was bound correctly and invoked on
 * every request but never returned `success: false` — 40 concurrent requests against a limit of
 * 15, all on one colo with one key, all allowed. That matches its own documentation ("permissive,
 * eventually consistent, and intentionally designed to not be used as an accurate accounting
 * system"), so it is the wrong tool for refusing a brute force. This is deterministic instead,
 * and the test suite can prove the Nth call is refused.
 *
 * **Sharded by key, never global.** Callers do `idFromName(key)`, so every IP (and every
 * ip+account pair) gets its own instance. A single global counter would serialise every login in
 * the school through one object and hand an attacker a much cheaper target than the thing it
 * protects.
 *
 * **State is instance memory, not storage.** No `ctx.storage` writes at all: a rate-limit counter
 * is worth nothing once its window has passed, and the whole point of this module is to refuse
 * traffic without spending per-request resources on it. An evicted instance forgets its count and
 * the next caller starts a fresh window — permissive under eviction, which is the same direction
 * every other failure here errs in.
 */
export class RateLimiter extends DurableObject<Env> {
  private count = 0;
  private windowStart = 0;

  /**
   * Record one attempt and say whether it is allowed.
   *
   * Fixed window rather than sliding: an attacker can land up to `2 * limit` across a window
   * boundary, which is irrelevant at the volumes this defends against and costs one comparison
   * instead of retaining a timestamp per attempt.
   *
   * @param limit    attempts permitted per window
   * @param periodMs window length in milliseconds
   * @returns true to proceed, false to refuse
   */
  async check(limit: number, periodMs: number): Promise<boolean> {
    const now = Date.now();
    if (now - this.windowStart >= periodMs) {
      this.windowStart = now;
      this.count = 0;
    }
    this.count++;
    return this.count <= limit;
  }
}
