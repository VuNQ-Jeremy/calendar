import { describe, it, expect, beforeEach, vi } from 'vitest';
import { startLive, isLiveLayoutRefreshPending } from '../src/lib/live.js';
import { cacheGet, cacheSet, clearCache, isStale } from '../src/lib/cache.js';
import { invalidateAfterMutation, K } from '../src/lib/route-cache.js';

/**
 * The browser half of live updates (src/lib/live.ts).
 *
 * jsdom gives us a WebSocket-shaped seam: startLive only ever calls
 * `new WebSocket(url)` and assigns onopen/onmessage/onclose, so a fake class is
 * enough to drive it.
 */

class FakeSocket {
  static last: FakeSocket | null = null;
  static readonly OPEN = 1;

  url: string;
  readyState = 1;
  sent: string[] = [];
  onopen: (() => void) | null = null;
  onmessage: ((ev: { data: unknown }) => void) | null = null;
  onclose: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(url: string) {
    this.url = url;
    FakeSocket.last = this;
  }
  send(data: string) {
    this.sent.push(data);
  }
  close() {
    this.readyState = 3;
  }
  /** Deliver a server message the way the real socket would. */
  receive(payload: unknown) {
    this.onmessage?.({ data: JSON.stringify(payload) });
  }
}

let stop: (() => void) | null = null;

beforeEach(() => {
  clearCache();
  FakeSocket.last = null;
  vi.stubGlobal('WebSocket', FakeSocket as unknown as typeof WebSocket);
});

function start(revalidate: () => Promise<void> | null = () => null) {
  stop?.();
  stop = startLive(revalidate);
  FakeSocket.last!.onopen?.();
  return FakeSocket.last!;
}

describe('live client', () => {
  it('connects to /ws on the current origin', () => {
    const socket = start();
    expect(socket.url).toMatch(/\/ws$/);
    stop?.();
  });

  it('marks the mutated domain stale rather than deleting it', () => {
    cacheSet(K.calendar, { events: [] });
    const socket = start();

    socket.receive({ type: 'invalidate', domain: 'calendar', ts: Date.now() });

    // Still served instantly (a remote change must not blank the screen), but
    // flagged so swrLoad refreshes it underneath.
    expect(isStale(K.calendar)).toBe(true);
    expect(cacheGet(K.calendar)).toBeDefined();
    stop?.();
  });

  it('ignores a message announcing a domain it does not know', () => {
    cacheSet(K.calendar, { events: [] });
    const socket = start();
    socket.receive({ type: 'invalidate', domain: 'nonsense', ts: Date.now() });
    expect(isStale(K.calendar)).toBe(false);
    stop?.();
  });

  it('ignores the echo of a mutation this tab just made', () => {
    cacheSet(K.calendar, { events: [] });
    invalidateAfterMutation('calendar'); // hard-invalidates, so re-cache below
    cacheSet(K.calendar, { events: [] });

    const socket = start();
    socket.receive({ type: 'invalidate', domain: 'calendar', ts: Date.now() });

    expect(isStale(K.calendar)).toBe(false);
    stop?.();
  });

  /**
   * The bug this guards: React Router asks shouldRevalidate several times per
   * revalidation and acts on the LAST answer. A flag that cleared itself on
   * read answered true once and false afterwards, so React Router concluded
   * there was nothing to load and the sidebar badges never moved.
   */
  it('keeps the layout-refresh flag set for the whole revalidation', async () => {
    let settle: () => void = () => {};
    const running = new Promise<void>((resolve) => (settle = resolve));
    const socket = start(() => running);

    socket.receive({ type: 'invalidate', domain: 'feedback', ts: Date.now() });

    // Asked repeatedly, it must keep saying yes.
    expect(isLiveLayoutRefreshPending()).toBe(true);
    expect(isLiveLayoutRefreshPending()).toBe(true);
    expect(isLiveLayoutRefreshPending()).toBe(true);

    settle();
    await running;
    await new Promise((r) => setTimeout(r, 0));

    expect(isLiveLayoutRefreshPending()).toBe(false);
    stop?.();
  });

  it('leaves the flag set when the app declines because it is busy', () => {
    const socket = start(() => null);
    socket.receive({ type: 'invalidate', domain: 'people', ts: Date.now() });
    // Nothing ran it, so the next revalidation must still see the request.
    expect(isLiveLayoutRefreshPending()).toBe(true);
    stop?.();
  });

  it('does not ask for a layout refresh for non-badge domains', () => {
    cacheSet(K.calendar, { events: [] });
    const socket = start(() => Promise.resolve());
    socket.receive({ type: 'invalidate', domain: 'calendar', ts: Date.now() });
    expect(isLiveLayoutRefreshPending()).toBe(false);
    stop?.();
  });

  it('marks everything stale after a reconnect, since messages were missed', () => {
    cacheSet(K.calendar, { events: [] });
    cacheSet(K.people, { students: [] });
    const socket = start(() => Promise.resolve());

    socket.onclose?.(); // drop
    socket.onopen?.(); // and come back

    expect(isStale(K.calendar)).toBe(true);
    expect(isStale(K.people)).toBe(true);
    stop?.();
  });
});
