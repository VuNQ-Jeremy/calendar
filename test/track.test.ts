import { describe, it, expect, vi, beforeEach } from 'vitest';

/**
 * The beacon buffer (`buf`/`lastPath`/`timer` in src/lib/track.ts) is module-level state, so each
 * test re-imports the module fresh via `vi.resetModules()` rather than sharing one instance —
 * otherwise a path tracked in one test would dedupe or pre-fill the buffer in the next.
 */
async function freshTrack() {
  vi.resetModules();
  return import('../src/lib/track.js');
}

beforeEach(() => {
  vi.useFakeTimers();
});

describe('trackView', () => {
  it('dedupes consecutive calls with the same path', async () => {
    const { trackView } = await freshTrack();
    trackView('/dashboard');
    trackView('/dashboard');
    trackView('/dashboard');
    // Nothing has flushed yet (under MAX_BUF, timer not elapsed) — advance it and check the
    // single POST that follows the single buffered event.
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const body = init.body as FormData;
    const sent = JSON.parse(body.get('payload') as string);
    expect(sent.events).toHaveLength(1);
    expect(sent.events[0].path).toBe('/dashboard');
  });

  it('flushes immediately once the buffer hits MAX_BUF, without waiting for the timer', async () => {
    const { trackView } = await freshTrack();
    for (let i = 0; i < 20; i++) trackView(`/page-${i}`);
    // Microtask flush for the `void flushNow()` fire-and-forget call.
    await vi.advanceTimersByTimeAsync(0);
    expect(fetch).toHaveBeenCalledTimes(1);
    const [, init] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [
      string,
      RequestInit,
    ];
    const sent = JSON.parse((init.body as FormData).get('payload') as string);
    expect(sent.events).toHaveLength(20);
  });

  it('resets the flush timer after each flush, so a later view schedules a new one', async () => {
    const { trackView } = await freshTrack();
    trackView('/a');
    await vi.advanceTimersByTimeAsync(15_000);
    expect(fetch).toHaveBeenCalledTimes(1);

    // A view tracked well after the first flush must not ride a stale timer — it gets its own
    // fresh 15s window.
    await vi.advanceTimersByTimeAsync(5_000);
    trackView('/b');
    await vi.advanceTimersByTimeAsync(14_999);
    expect(fetch).toHaveBeenCalledTimes(1); // not yet
    await vi.advanceTimersByTimeAsync(1);
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('posts to /track, never /api/track', async () => {
    const { trackView } = await freshTrack();
    trackView('/vocabulary');
    await vi.advanceTimersByTimeAsync(15_000);
    const [url] = (fetch as unknown as { mock: { calls: unknown[][] } }).mock.calls[0] as [string];
    expect(url).toBe('/track');
  });
});
