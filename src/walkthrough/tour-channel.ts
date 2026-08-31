/**
 * Wire protocol between the two browser windows involved in an admin walkthrough: the checklist
 * (Task 4), which drives a tour by opening the target app screen with `window.open`, and the tour
 * driver overlay (Task 3) that mounts inside that second window and spotlights controls.
 *
 * BroadcastChannel is a NEW pattern in this repo (zero prior uses) — worth justifying rather than
 * reaching for the existing realtime mechanism. `src/lib/live.ts` pushes invalidations through the
 * LiveHub Durable Object over a `/ws` WebSocket; that machinery exists because it has to cross
 * accounts and processes — a mutation by one user's session must reach a completely different
 * user's open tab, so a server has to sit in the middle. A tour is nothing like that: both windows
 * are the same origin, opened by the same browser tab, in the same session. Routing "spotlight the
 * next button" through a Durable Object would add a server round trip (and a cross-account fan-out
 * path) to a conversation that never leaves the machine. BroadcastChannel is the platform primitive
 * for exactly this — same-origin contexts talking to each other directly — so this module is a thin,
 * typed wrapper over it rather than a new use of `live.ts`.
 */

/**
 * All messages that can cross the tour channel:
 * - `run`  — checklist → driver: this story/step is now active; drive to it.
 * - `stop` — EITHER direction: the tour is over. The checklist ends it when the user closes the
 *   run; the driver ends it when the user presses Stop in the coach bubble. Whoever receives it
 *   tears down. It carries no token because ending a tour that is already over is a no-op, and a
 *   Stop pressed in a window whose token has been forgotten must still be able to stop things.
 * - `hello` — driver → checklist: a freshly-opened window announcing itself and asking for the
 *   current run state (the driver has no other way to learn what the checklist already knows).
 * - `tick` — driver → checklist: this step auto-completed on its own (e.g. the user performed the
 *   real action); the checklist should tick the matching checkbox.
 * - `ready` — driver → checklist: the driver has mounted and is showing the given story on the
 *   given route, so the checklist can confirm the window landed where it meant to send it.
 *
 * THE `token` FIELD, and why three variants carry one.
 *
 * A BroadcastChannel reaches EVERY same-origin context on the channel name — every open Mochi tab,
 * not just the two windows taking part in the tour (see the note on `openTourChannel` below). The
 * driver overlay is mounted in the app shell for all staff, so without a discriminator a `run`
 * would be obeyed by the checklist's own tab and by any stale background tab, and a stale tab that
 * happened to be sitting on the story's route would immediately post a `tick` for a step no human
 * performed — a step silently marked done, which is the worst outcome this feature can produce.
 *
 * So the checklist mints a random token per tour and opens the popup as `${route}?tour=${token}`.
 * A driver acts only on messages whose `token` matches the one in its OWN `location.search`, and
 * echoes it on everything it posts; a window without the query param is not a tour window at all
 * and stays inert. The token is a window discriminator, not a secret: it never leaves the machine
 * and grants nothing.
 */
export type TourMsg =
  | { t: 'run'; token: string; storyId: string; stepIdx: number }
  | { t: 'stop' }
  | { t: 'hello' }
  | { t: 'tick'; token: string; storyId: string; stepIdx: number }
  | { t: 'ready'; token: string; storyId: string; route: string };

/**
 * Is this really one of ours?
 *
 * `openTourChannel` hands its subscriber `ev.data` untouched — it types the callback as `TourMsg`
 * but performs no runtime narrowing, and a BroadcastChannel is keyed only by a channel NAME. Any
 * same-origin context (another tab of this app, a browser extension's content script, a future
 * feature that picks the same string) can post arbitrary structured-cloneable junk onto it. So
 * everything that arrives is treated as unknown until it has been checked here; anything that
 * fails is dropped silently, because a malformed message is not an error condition we can report
 * to anyone useful.
 *
 * This lives in the PROTOCOL module, beside the type it narrows and the token rules it enforces,
 * rather than in either endpoint. Both ends must agree on what a valid message is, and two copies
 * of these rules would be two chances to disagree; putting it here also keeps the checklist screen
 * from importing the driver — a 20-line predicate is not worth pulling an overlay component, its
 * measurement loop and its react-router hooks into the checklist's import graph.
 *
 * NOTE what this does and does not check: it validates SHAPE only. Whether a `token` is the one
 * this window is taking part in is a separate question, and each endpoint answers it for itself
 * against its own tour — see the `token` note above.
 */
export function isTourMsg(m: unknown): m is TourMsg {
  if (typeof m !== 'object' || m === null) return false;
  const t = (m as { t?: unknown }).t;
  if (t === 'stop' || t === 'hello') return true;
  const token = (m as { token?: unknown }).token;
  if (t === 'run' || t === 'tick') {
    const { storyId, stepIdx } = m as { storyId?: unknown; stepIdx?: unknown };
    return (
      typeof token === 'string' &&
      typeof storyId === 'string' &&
      typeof stepIdx === 'number' &&
      Number.isInteger(stepIdx)
    );
  }
  if (t === 'ready') {
    const { storyId, route } = m as { storyId?: unknown; route?: unknown };
    return typeof token === 'string' && typeof storyId === 'string' && typeof route === 'string';
  }
  return false;
}

const CHANNEL_NAME = 'mochi-tour';

/**
 * Open the tour channel, subscribing `onMsg` to every message posted from the *other* end.
 *
 * SSR-safe: this app server-renders on Cloudflare Workers, where `BroadcastChannel` does not exist
 * (the guard below, not a feature check, is what makes it safe to import this module from a route
 * that also renders on the server) — same guard style as `src/lib/track.ts`'s `document` check. In
 * that environment nothing can be listening on the other side anyway, so a no-op stub is correct,
 * not just harmless.
 *
 * WHAT THE CHANNEL DOES AND DOES NOT FILTER. Per the spec, a BroadcastChannel never delivers a
 * message back to the BroadcastChannel OBJECT that posted it — and that is the whole of it. Every
 * OTHER same-origin context subscribed to the name does receive it, including other tabs of this
 * app that have nothing to do with the tour, and including a second channel object opened in the
 * posting window itself. So `onMsg` is NOT "messages from the other window"; it is "messages from
 * every other subscriber on this origin". That is precisely why `run`/`tick`/`ready` carry a
 * `token` (see above): the wrapper cannot tell the tour's two windows apart, so the messages do.
 */
export function openTourChannel(onMsg: (m: TourMsg) => void): {
  post: (m: TourMsg) => void;
  close: () => void;
} {
  if (typeof BroadcastChannel === 'undefined') {
    return { post() {}, close() {} };
  }

  const bc = new BroadcastChannel(CHANNEL_NAME);
  bc.onmessage = (ev: MessageEvent<TourMsg>) => onMsg(ev.data);

  return {
    post(m: TourMsg) {
      // This rule targets window.postMessage, where an omitted targetOrigin leaks the message to
      // any origin a hostile page navigated the target to. BroadcastChannel has no such parameter
      // (and no `.location` to supply one from, despite the rule's suggested fix) — delivery is
      // restricted to same-origin contexts on the same channel name by the platform itself, so
      // there is nothing to pass here.
      // oxlint-disable-next-line unicorn/require-post-message-target-origin
      bc.postMessage(m);
    },
    close() {
      bc.close();
    },
  };
}
