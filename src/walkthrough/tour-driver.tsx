import React, { useEffect, useRef, useState } from 'react';
import { useFetchers, useLocation, useNavigation } from 'react-router';
import { STORIES } from '../../shared/walkthrough.js';
import type { TourStep, TourStory, TourTarget } from '../../shared/walkthrough.js';
import { isTourMsg, openTourChannel } from './tour-channel.js';
import type { TourMsg } from './tour-channel.js';
import { useLang } from '../lib/i18n.jsx';

/**
 * The tour driver — the half of the walkthrough that lives in the SECOND browser window.
 *
 * The checklist screen (/walkthrough) opens a story's route with `window.open` and announces the
 * active story/step on the BroadcastChannel from `./tour-channel.ts`. This component is mounted
 * globally in the app shell (`app/routes/_app.tsx`), so whatever screen that window lands on, the
 * driver is already there listening. It is completely inert until a `run` message arrives: with no
 * tour running it renders `null` and holds nothing but one idle channel.
 *
 * WHAT IT DOES AND, MORE IMPORTANTLY, WHAT IT DOES NOT. It spotlights the control the current step
 * points at, pre-fills text inputs in a dialog with placeholder values, and ticks off the steps it
 * can actually observe completing. It NEVER clicks anything. Every real action — pressing Save,
 * picking from a portalled menu, confirming a delete — is the human's, on purpose: this is a
 * walkthrough of the product run against a live deployment, and a driver that pressed buttons would
 * be a robot writing rows into someone's school. The overlay is therefore `pointer-events: none`
 * everywhere except its own coach bubble; it must never stand between the user and a control.
 *
 * Shape and technique are cloned from `src/dev-inspector.tsx`: one fixed full-viewport container,
 * targets measured with `getBoundingClientRect()`, absolutely-positioned boxes drawn from those
 * numbers. The differences are that this one must keep re-measuring (targets mount late, dialogs
 * animate in, lists reflow) and must sit above `.m-overlay` (z-index 1000) AND the dev inspector
 * (9999), hence 10000.
 */

/** How often we re-resolve and re-measure the target. Cheap: a handful of `querySelectorAll`s. */
const TICK_MS = 300;

/** Breathing room, in px, between the target's own box and the spotlight ring / scrim hole. */
const PAD = 6;

// ---------------------------------------------------------------------------------------------
// Target resolution
// ---------------------------------------------------------------------------------------------

/**
 * What resolving a step's target produced. `ambiguous` is a first-class outcome, not a failure to
 * paper over: if two elements answer to the same name after every disambiguation rule below, the
 * driver says so in the coach bubble rather than spotlighting whichever one the DOM happened to
 * list first and sending the user off to press the wrong Delete.
 */
type Resolution =
  { kind: 'found'; el: HTMLElement } | { kind: 'missing' } | { kind: 'ambiguous'; count: number };

const text = (el: Element) => (el.textContent || '').replaceAll(/\s+/gu, ' ').trim();

/**
 * The open dialogs, outermost first. `Modal` in `src/ui.tsx` renders `.m-overlay > .m-dialog`
 * INLINE in the React tree — it does not portal (only `MSelect`'s menu and `MDatePicker`'s calendar
 * do) — so a plain document query finds them, and DOM order is nesting order: a dialog opened from
 * inside another dialog is rendered inside it and therefore comes later.
 */
function openDialogs(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('.m-dialog')];
}

/** The dialog whose `.m-dialog__title` matches `title` exactly, innermost first. */
function dialogByTitle(title: string): HTMLElement | null {
  const all = openDialogs().filter((d) => {
    const h = d.querySelector('.m-dialog__title');
    return h != null && text(h) === title;
  });
  return all.length > 0 ? all[all.length - 1]! : null;
}

/**
 * Drop every candidate that CONTAINS another candidate, i.e. keep the innermost matches.
 *
 * A button whose accessible name is "Save" is one element, but a card wrapper with `role="button"`
 * around it has the same `textContent`, and so does an `<a>` that wraps both. Spotlighting the
 * outer one draws a ring around half the screen. Keeping only the innermost matches collapses that
 * family to the control the user is actually meant to press.
 */
function innermost(els: HTMLElement[]): HTMLElement[] {
  return els.filter((a) => !els.some((b) => b !== a && a.contains(b)));
}

function matchByName(root: Document | HTMLElement, name: string): HTMLElement[] {
  const els = [...root.querySelectorAll<HTMLElement>('button, [role="button"], a')];
  // Exact match on the trimmed text, mirroring Playwright's `getByRole(..., { exact: true })`
  // semantics cheaply — the catalogue's strings were read out of the e2e specs, which use exactly
  // that. `aria-label` is the fallback for icon-only controls, which have no text at all.
  return innermost(
    els.filter((el) => text(el) === name || (el.getAttribute('aria-label') || '').trim() === name),
  );
}

/**
 * Resolve `{ button }`.
 *
 * NON-UNIQUE NAMES ARE THE NORM HERE, not an edge case: "Delete" and "Save" each match several
 * elements on most screens (a row action per list item, plus the confirm button inside whatever
 * dialog is up). The rule, in order:
 *
 *  1. If any dialog is open, search the TOPMOST one first. That is where the user's attention is
 *     and where a confirm/save button lives; the "Delete" buttons still sitting in the list behind
 *     the overlay are not what a step following an `opensDialog` means.
 *  2. Only when no dialog is open, or the topmost one holds no match, search the whole document.
 *  3. Whatever set survives, take the innermost matches (see `innermost`).
 *  4. If more than one still stands, report `ambiguous`. Never pick arbitrarily.
 */
function resolveButton(name: string): Resolution {
  const dialogs = openDialogs();
  const top = dialogs.length > 0 ? dialogs[dialogs.length - 1]! : null;

  let hits = top ? matchByName(top, name) : [];
  if (hits.length === 0) hits = matchByName(document, name);

  if (hits.length === 0) return { kind: 'missing' };
  if (hits.length > 1) return { kind: 'ambiguous', count: hits.length };
  return { kind: 'found', el: hits[0]! };
}

/**
 * The control inside a `.mochi-field` wrapper, if it has one.
 *
 * Returns the input rather than the wrapper so the spotlight ring hugs the box the user types in,
 * and so `fill` has something to write to. Falls back to the wrapper for fields whose control is a
 * portalling `MSelect` trigger or a date picker — there is still something worth pointing at.
 */
function controlIn(field: HTMLElement): HTMLElement {
  return field.querySelector<HTMLElement>('input.mochi-input, textarea.mochi-input') ?? field;
}

/**
 * Resolve `{ field, dialog }` — and this is the one place the app is genuinely inconsistent, so the
 * resolver deliberately tries TWO structures:
 *
 *  A. THE `.mochi-field` STRUCTURE, which nearly every screen uses (classes, people, config,
 *     calendar, questions, tests, materials, feedback…). The screens build FormData in JS: there is
 *     no `<form>`, no `name=` attribute and — the point here — no `for`/`id` association between
 *     the label and the control. The only handle is structural: a `.mochi-field` whose direct child
 *     `label.mochi-field__label` carries the label text, with the control inside. That is exactly
 *     the contract `e2e/crud-helpers.ts` encodes (`.mochi-field:has(> label.mochi-field__label…)`).
 *
 *  B. A REAL LABEL ASSOCIATION — `label[for]` → `getElementById`, and a `<label>` that wraps its
 *     own control. This is NOT needed for the /vocabulary screen's "Topic name", which is the case
 *     that first made this look like two worlds: `DS.Input` (src/ds/bundle.js) renders
 *     `div.mochi-field > label.mochi-field__label[for] + input.mochi-input`, so it carries a real
 *     `for`/`id` pair AND the structural classes, and path A already finds it. (The e2e specs
 *     reach it with `page.getByLabel`, which is why it reads as a different pattern in the specs.)
 *     Path B stays as belt-and-braces for any control that has only the association and none of the
 *     classes — a label-wrapped input, or a design-system component that has not been given the
 *     `.mochi-field` chrome. It costs one extra query on the miss path and nothing on the hit path.
 *
 * Structure A is tried first because it is overwhelmingly the common case, and because a
 * `.mochi-field` wrapper is the more useful thing to fall back to when the control is a portalling
 * menu trigger.
 */
function resolveField(fieldLabel: string, dialogTitle?: string): Resolution {
  // Scope: the named dialog if the step names one and it is open; otherwise the topmost open
  // dialog; otherwise the page. A named dialog that is NOT open means the step is not ready yet —
  // report missing rather than reaching into the page behind it and pointing at a same-named field.
  const dialogs = openDialogs();
  // `Document | HTMLElement`, not the DOM lib's `ParentNode`: this project's tsconfig also pulls in
  // the Workers runtime types, whose HTMLRewriter `ParentNode` has an incompatible `append`.
  let root: Document | HTMLElement;
  if (dialogTitle) {
    const d = dialogByTitle(dialogTitle);
    if (!d) return { kind: 'missing' };
    root = d;
  } else {
    root = dialogs.length > 0 ? dialogs[dialogs.length - 1]! : document;
  }

  // A: the `.mochi-field` structure.
  const fields = [...root.querySelectorAll<HTMLElement>('.mochi-field')].filter((f) => {
    const lab = f.querySelector(':scope > label.mochi-field__label');
    return lab != null && text(lab) === fieldLabel;
  });
  const structural = innermost(fields);
  if (structural.length === 1) return { kind: 'found', el: controlIn(structural[0]!) };
  if (structural.length > 1) return { kind: 'ambiguous', count: structural.length };

  // B: a real `<label>` association — `label[for]` → `getElementById`, or a label wrapping its
  // own control. (`getElementById` searches the whole document by necessity; the id came from a
  // label inside `root`, so it still resolves within the scope we meant.)
  const labels = [...root.querySelectorAll<HTMLLabelElement>('label')].filter(
    (l) => text(l) === fieldLabel || text(l).replace(/\*$/u, '').trim() === fieldLabel,
  );
  const associated: HTMLElement[] = [];
  for (const l of labels) {
    const forId = l.getAttribute('for');
    const byId = forId ? document.getElementById(forId) : null;
    const wrapped = l.querySelector<HTMLElement>('input, textarea, select');
    const el = byId ?? wrapped;
    if (el && !associated.includes(el)) associated.push(el);
  }
  if (associated.length === 1) return { kind: 'found', el: associated[0]! };
  if (associated.length > 1) return { kind: 'ambiguous', count: associated.length };

  return { kind: 'missing' };
}

/** Resolve whichever target shape the step carries. */
function resolveTarget(target: TourTarget): Resolution {
  if ('button' in target) return resolveButton(target.button);
  if ('field' in target) return resolveField(target.field, target.dialog);
  const el = document.querySelector<HTMLElement>(target.css);
  return el ? { kind: 'found', el } : { kind: 'missing' };
}

/** The target a step points at, if it has one. `fill` points at its dialog's first field. */
function targetOf(step: TourStep): TourTarget | null {
  if (step.kind === 'click' || step.kind === 'submit') return step.target;
  if (step.kind === 'fill' && step.fields.length > 0) {
    return { field: step.fields[0]!.field, dialog: step.dialog };
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Prefill
// ---------------------------------------------------------------------------------------------

/**
 * Set a controlled input's value so React notices.
 *
 * EVERY text input in this app is a controlled React input (`value={state}` + `onChange`). Assigning
 * `el.value = x` does update the DOM node, but React's next render sees its own unchanged state and
 * writes the old value straight back — the typed text vanishes a frame later, and worse, the form's
 * state never held it at all, so a save would post the old value while the screen briefly showed the
 * new one. The fix is to go around React's value tracker: call the NATIVE `value` setter from the
 * element's prototype (React patches the instance property to detect exactly this), then dispatch a
 * bubbling `input` event, which is what React's synthetic `onChange` is built on. That path is
 * indistinguishable from a real keystroke as far as the component is concerned.
 */
function setNativeValue(el: HTMLInputElement | HTMLTextAreaElement, value: string) {
  const proto =
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, 'value')?.set;
  if (!setter) return;
  setter.call(el, value);
  el.dispatchEvent(new Event('input', { bubbles: true }));
}

type FillState =
  | { status: 'idle' }
  /** Every value verifiably stuck; the step auto-ticked. */
  | { status: 'filled' }
  /** At least one value was reverted by the component. The human has to type it. */
  | { status: 'manual'; values: { field: string; value: string }[] };

// ---------------------------------------------------------------------------------------------
// Submission watching
// ---------------------------------------------------------------------------------------------

/**
 * Does a React Router `formAction` correspond to the step's `post` path?
 *
 * The screens submit with `fetcher.submit(fd, { method: 'post' })` and no explicit action, so the
 * formAction React Router reports is the route pathname (sometimes absolute, sometimes carrying the
 * `.data` suffix or a query string depending on how it was produced). Normalise all of that away
 * before comparing, and require a path boundary so `/people` does not match `/peoplezzz`.
 */
function actionMatches(formAction: string | undefined, post: string): boolean {
  if (!formAction) return false;
  let path = formAction;
  const q = path.search(/[?#]/u);
  if (q >= 0) path = path.slice(0, q);
  if (path.startsWith('http')) {
    try {
      path = new URL(path).pathname;
    } catch {
      /* not a URL after all; compare what we have */
    }
  }
  if (path.endsWith('.data')) path = path.slice(0, -'.data'.length);
  if (path.length > 1 && path.endsWith('/')) path = path.slice(0, -1);
  return path === post || path.startsWith(post + '/');
}

/**
 * Recognise the shapes this app's route actions actually return on failure. Read straight out of
 * `app/routes/classes.tsx` and `app/routes/people.tsx` (both `withLiveAction`-wrapped, same
 * pattern everywhere else in `app/routes/`): a validation or lookup failure is a RETURNED (never
 * thrown) `Response.json({ error: 'missing id' }, { status: 400 })` for a single named failure, or
 * `Response.json({ errors: parsed.error.flatten() }, { status: 400 })` — Zod's
 * `{ formErrors: string[]; fieldErrors: Record<string, string[] | undefined> }` — for a schema
 * failure. Because the action RETURNS the Response instead of throwing it, React Router does not
 * divert it to an error boundary; it lands as `fetcher.data`, parsed, status code and all — which is
 * exactly why every dialog in this codebase already reads `fetcher.data?.error` to show its own
 * inline message (see `src/screens-config.tsx`, `src/tests/grading.tsx`, `src/tests/take.tsx`, …).
 * This function is the walkthrough's read of that same, already-established shape.
 *
 * Anything else — `undefined` (no submission observed yet), `{ ok: true }`, or an object with
 * neither `error` nor a populated `errors` — returns `null`: "not a failure I recognise." That is
 * deliberate, not a gap to fill in later. See the long comment at the call site for why this
 * function must never be tightened into treating an unrecognised shape as a failure: the walkthrough
 * would rather occasionally fail to catch a real error (the human notices the open dialog and ticks
 * by hand) than ever claim a save worked when it did not.
 */
function submitFailureMessage(data: unknown): string | null {
  if (!data || typeof data !== 'object') return null;
  const d = data as Record<string, unknown>;
  if (typeof d.error === 'string' && d.error) return d.error;
  if (d.errors && typeof d.errors === 'object') {
    const errs = d.errors as { formErrors?: unknown; fieldErrors?: unknown };
    const formErrors = Array.isArray(errs.formErrors) ? errs.formErrors : [];
    const fieldErrors =
      errs.fieldErrors && typeof errs.fieldErrors === 'object'
        ? Object.values(errs.fieldErrors as Record<string, unknown>).flat()
        : [];
    const messages = [...formErrors, ...fieldErrors].filter(
      (m): m is string => typeof m === 'string' && m.length > 0,
    );
    if (messages.length) return messages.join('; ');
    // `errors` present but nothing readable inside it — flatten() always carries both keys, so a
    // populated-but-empty object is not a shape these actions produce for a real failure. Falling
    // through to `null` rather than inventing a blank warning is the same "cannot tell" call as
    // every other branch here.
  }
  return null;
}

// ---------------------------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------------------------

interface Active {
  storyId: string;
  stepIdx: number;
}

interface Measured {
  top: number;
  left: number;
  width: number;
  height: number;
  vw: number;
  vh: number;
}

const sameRect = (a: Measured | null, b: Measured | null) =>
  a === b ||
  (a != null &&
    b != null &&
    Math.round(a.top) === Math.round(b.top) &&
    Math.round(a.left) === Math.round(b.left) &&
    Math.round(a.width) === Math.round(b.width) &&
    Math.round(a.height) === Math.round(b.height) &&
    a.vw === b.vw &&
    a.vh === b.vh);

export function TourDriver() {
  const { lang } = useLang();
  const location = useLocation();
  const fetchers = useFetchers();
  const navigation = useNavigation();

  /**
   * This window's tour token, read ONCE from its own query string.
   *
   * A BroadcastChannel reaches every same-origin tab, not just the tour's two windows, and this
   * overlay is mounted in the app shell for every staff user. Without a discriminator the
   * checklist's own tab would paint a coach bubble over /walkthrough, and any stale background tab
   * already sitting on the story's route would fire the `goto` branch and post a `tick` for a step
   * no human performed. The checklist therefore opens the tour window as `?tour=<random>` and this
   * driver obeys only messages carrying that same token; a window without the param is not a tour
   * window and stays completely inert.
   *
   * Read once, in a lazy initialiser, and never re-read: the user navigates this window during the
   * tour (`goto` steps say "Open People"), and the query param does not survive that. The token is
   * a property of the WINDOW, not of the current URL. `window` is guarded because the app shell
   * server-renders on Workers.
   */
  const [myToken] = useState<string | null>(() =>
    typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('tour'),
  );

  const [active, setActive] = useState<Active | null>(null);
  const [rect, setRect] = useState<Measured | null>(null);
  const [status, setStatus] = useState<Resolution['kind'] | 'none'>('none');
  const [ambiguousCount, setAmbiguousCount] = useState(0);
  const [fill, setFill] = useState<FillState>({ status: 'idle' });
  const [copied, setCopied] = useState<string | null>(null);
  /** Set on the falling edge of a `submit` step whose fetcher came back with a failure shape (see
   *  `submitFailureMessage`) instead of ticking. Cleared per-step, same as the other scratch state. */
  const [submitError, setSubmitError] = useState<string | null>(null);

  const postRef = useRef<(m: TourMsg) => void>(() => {});
  /** Steps already ticked, as `storyId:stepIdx`, so a tick is posted at most once per step. */
  const tickedRef = useRef(new Set<string>());
  /** Steps whose prefill has been attempted, so a re-render does not retype over the user. */
  const filledRef = useRef(new Set<string>());
  /** Steps whose target we have already scrolled into view (once per step, never fighting the user). */
  const scrolledRef = useRef(new Set<string>());
  /** True once a matching submission has been SEEN in flight — a `submit` step ticks on the edge. */
  const sawSubmitRef = useRef(false);
  /**
   * The action result captured off the matched fetcher WHILE IT WAS STILL BUSY, for the
   * busy→idle edge below to read.
   *
   * An earlier version of this looked the fetcher back up by KEY once it went idle
   * (`fetchers.find(f => f.key === key)`), and that lookup can never succeed. `useFetchers()`
   * mirrors `state.fetchers` (react-router/dist/development/lib/dom/lib.js, `useFetchers`), and
   * react-router's `updateState` (…/lib/router/router.js) walks every fetcher whose `state` is
   * `"idle"` and deletes it from that map SYNCHRONOUSLY, in the very call that notifies
   * subscribers — before React's scheduled render for that notification ever runs. So by the
   * time this effect's falling-edge branch executed, the entry was already gone and `.data` read
   * back as `undefined` on every single save, success or failure alike. That made the whole
   * failure-detection mechanism inert: `submitFailureMessage(undefined)` is always `null`, so a
   * failed save still ticked green — silently defeating the one guarantee this feature exists
   * to provide.
   *
   * The result IS available one phase earlier, though. On the render where a submission moves
   * from "submitting" to "loading" (the post-action revalidation phase), react-router builds
   * that fetcher entry with `getLoadingFetcher(submission, actionResult.data)` — the action's
   * result is attached to the fetcher WHILE IT IS STILL BUSY, not after it goes idle. So this ref
   * is written on every render where the matched fetcher is busy (see the busy branch below),
   * capturing whatever `.data` it currently carries; by the time the entry disappears from
   * `useFetchers()`, the ref already holds the last value it had, which is the actual result.
   */
  const submitFetcherDataRef = useRef<unknown>(undefined);
  /**
   * The pending prefill verification. These live on the component, not inside the measuring effect,
   * because that effect re-runs whenever `active` changes identity — including on a redundant `run`
   * from the checklist — and tearing the verification down there would silently strand a fill that
   * had already been typed: the step would never tick and never report the manual fallback either.
   * Only unmount cancels them.
   */
  const verifyRaf = useRef(0);
  const verifyTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  /**
   * Drop any pending prefill verification.
   *
   * It has to be cancellable from three places, because a verification that lands late writes onto
   * whatever step is showing THEN, not the one it was measuring: it would flash a bogus "the form
   * did not accept the typed values" on an unrelated fill step. So it is cancelled when the step
   * changes, at the top of a fresh `doFill` (a second fill must not leave the first one's timers
   * armed and overwritten), and on unmount.
   */
  const cancelVerify = React.useCallback(() => {
    if (verifyRaf.current) cancelAnimationFrame(verifyRaf.current);
    if (verifyTimer.current) clearTimeout(verifyTimer.current);
    verifyRaf.current = 0;
    verifyTimer.current = undefined;
  }, []);

  useEffect(() => cancelVerify, [cancelVerify]);

  const story: TourStory | undefined = active
    ? STORIES.find((s) => s.id === active.storyId)
    : undefined;
  const step: TourStep | undefined = active ? story?.steps[active.stepIdx] : undefined;
  const stepKey = active ? `${active.storyId}:${active.stepIdx}` : '';

  // --- channel -------------------------------------------------------------------------------

  useEffect(() => {
    // Not a tour window: do not even subscribe. Every staff tab mounts this component, and a tab
    // that can never act on a message has no business holding a channel open to hear them.
    if (!myToken) return;

    const ch = openTourChannel((raw: unknown) => {
      // Narrow before acting: see `isTourMsg`. Anything else on this channel name is not ours.
      if (!isTourMsg(raw)) return;
      if (raw.t === 'run') {
        if (raw.token !== myToken) return; // someone else's tour
        setActive({ storyId: raw.storyId, stepIdx: raw.stepIdx });
      } else if (raw.t === 'stop') {
        // Untokenised on purpose (see tour-channel.ts): ending a tour we are not running is a no-op.
        setActive(null);
      }
      // `hello` / `tick` / `ready` are the driver's own outbound vocabulary; if one arrives here it
      // came from another driver window and is none of our business.
    });
    postRef.current = ch.post;
    // Announce ourselves — but only if we are a tour window at all. This window may have been
    // opened mid-tour (or reloaded), in which case the checklist already knows which story is
    // running and we do not. It answers with `run`.
    ch.post({ t: 'hello' });
    return () => {
      postRef.current = () => {};
      ch.close();
    };
  }, [myToken]);

  const tick = React.useCallback(
    (key: string, storyId: string, stepIdx: number) => {
      // Only the POSTED tick is deduplicated — the checklist must hear about a step once, not once per
      // 300ms poll. Advancing is NOT deduplicated: gating both meant that after Back onto a step the
      // checklist had already been told about, Next posted nothing AND moved nothing, so the driver
      // window could never go forward again for the rest of the story.
      if (myToken && !tickedRef.current.has(key)) {
        tickedRef.current.add(key);
        postRef.current({ t: 'tick', token: myToken, storyId, stepIdx });
      }
      // Advance locally as well as telling the checklist. The checklist will normally answer with a
      // `run` for the next step and we converge on the same index; advancing here too means the
      // overlay keeps moving even if the checklist window was closed mid-tour. The index guard is
      // what makes this safe to call from the 300ms poll: only the step still showing can advance.
      setActive((a) =>
        a && a.storyId === storyId && a.stepIdx === stepIdx ? { ...a, stepIdx: stepIdx + 1 } : a,
      );
    },
    [myToken],
  );

  /** End the tour from this window. */
  const stop = React.useCallback(() => {
    // Tell the checklist as well as tearing down here, so its "running" state does not survive a
    // tour the user ended from this window.
    postRef.current({ t: 'stop' });
    setActive(null);
  }, []);

  // --- reset per-story bookkeeping -------------------------------------------------------------

  // The three "already done this" sets are per STORY, not per step: keeping them across steps is
  // what lets Back walk backwards without a `goto` step instantly re-ticking and shoving the user
  // forward again. They are cleared when the story changes and when the tour stops (storyId becomes
  // undefined), so re-running the same story from the checklist starts genuinely fresh.
  useEffect(() => {
    tickedRef.current.clear();
    filledRef.current.clear();
    scrolledRef.current.clear();
  }, [active?.storyId]);

  // --- reset per-step scratch state ------------------------------------------------------------

  useEffect(() => {
    cancelVerify();
    setFill({ status: 'idle' });
    setCopied(null);
    setRect(null);
    setStatus('none');
    setSubmitError(null);
    sawSubmitRef.current = false;
    submitFetcherDataRef.current = undefined;
  }, [stepKey, cancelVerify]);

  // --- goto: tick as soon as this window is standing on the step's route -----------------------

  useEffect(() => {
    if (!active || !story || !step || step.kind !== 'goto') return;
    if (lang !== 'en') return;
    if (tickedRef.current.has(stepKey)) return; // `ready` is an announcement, not a heartbeat
    const p = location.pathname;
    if (p !== step.route && !p.startsWith(step.route + '/')) return;
    if (myToken)
      postRef.current({ t: 'ready', token: myToken, storyId: story.id, route: step.route });
    // A student/parent story's `goto` shares its route with the staff screen at the same path
    // (/dashboard, /vocabulary, ...) — this driver is staff-gated (only mounts in the `_app` shell),
    // so the ONLY account that can ever run this effect for one of those 7 stories is staff itself.
    // A pathname match here therefore proves nothing about which account's SCREEN is on glass: it is
    // exactly as true while an admin is looking at their own dashboard as it would be for a genuine
    // student session (which can never reach this code at all). That is the same "the signal cannot
    // distinguish success from the thing that looks like it" problem the submit-watcher below solves
    // by not ticking — so this does the same: `ready` above still fires (the window genuinely IS
    // standing on the route), but the tick that would claim the step done is withheld. The coach
    // bubble's warning (rendered below) tells the runner why, and that it is theirs to tick by hand
    // once they have actually signed in as that account in this window.
    if (story.account !== 'staff') return;
    tick(stepKey, active.storyId, active.stepIdx);
  }, [active, story, step, stepKey, location.pathname, lang, tick, myToken]);

  // --- submit: watch React Router's own submission state ---------------------------------------

  useEffect(() => {
    if (!active || !step || step.kind !== 'submit') return;
    if (lang !== 'en') return;

    // Both paths matter: most dialogs save through a `useFetcher`, but a few screens submit through
    // a navigation. Monkey-patching `fetch` would see both and also every unrelated request; the
    // router already exposes exactly what we need.
    const matchedFetcher = fetchers.find(
      (f) => f.state !== 'idle' && actionMatches(f.formAction, step.post),
    );
    const navBusy = navigation.state !== 'idle' && actionMatches(navigation.formAction, step.post);
    const busy = matchedFetcher != null || navBusy;

    if (busy) {
      sawSubmitRef.current = true;
      // Capture `.data` NOW, while the fetcher is still busy — see `submitFetcherDataRef`'s comment
      // for why re-looking the entry up by key once it goes idle cannot work. A navigation submit
      // leaves this `undefined` — there is no fetcher at all, and `useActionData()` for an arbitrary
      // route is not something this route-agnostic driver can reach — so its result falls into the
      // same "cannot tell" bucket handled below. This line re-runs on every busy render (the effect
      // depends on `fetchers`), so the ref ends up holding whatever `.data` was present on the LAST
      // busy render before the fetcher goes idle — which is exactly the render where react-router
      // attaches the action's result (see the comment on the ref).
      submitFetcherDataRef.current = matchedFetcher ? matchedFetcher.data : undefined;
      return;
    }
    // Idle again after having been busy => the save round-tripped. Tick on that falling edge only,
    // so merely landing on a page with no submission in flight never counts as a submit.
    if (sawSubmitRef.current) {
      sawSubmitRef.current = false;
      // Read the ref captured above, NOT `fetchers.find(f => f.key === key)?.data` — that lookup
      // always misses (see `submitFetcherDataRef`'s comment) and made failure detection inert.
      const data = submitFetcherDataRef.current;
      submitFetcherDataRef.current = undefined;
      // See `submitFailureMessage`'s long comment for the exact shapes this reads and, more
      // importantly, for why every shape it does NOT recognise (including the no-fetcher navigation
      // case, where `data` is `undefined`) must resolve to a tick rather than silence. A ticked step
      // the human can still see failed and re-fix by hand is a minor annoyance; a green check over an
      // open dialog showing an error is the failure mode this whole feature exists to prevent, and the
      // asymmetry between those two outcomes is deliberate.
      const failure = submitFailureMessage(data);
      if (failure) {
        setSubmitError(failure);
        return;
      }
      tick(stepKey, active.storyId, active.stepIdx);
    }
  }, [active, step, stepKey, fetchers, navigation.state, navigation.formAction, lang, tick]);

  // --- measure, poll for dialogs, prefill -------------------------------------------------------

  useEffect(() => {
    if (!active || !step || lang !== 'en') return;
    // Local, non-null copies: the closures below outlive this render, and TypeScript's narrowing of
    // the state variables does not reach into them.
    const a = active;
    const s = step;

    function measure() {
      const target = targetOf(s);
      if (!target) {
        setStatus('none');
        setRect(null);
      } else {
        const res = resolveTarget(target);
        setStatus(res.kind);
        if (res.kind === 'ambiguous') {
          setAmbiguousCount(res.count);
          setRect(null);
        } else if (res.kind === 'found') {
          const r = res.el.getBoundingClientRect();
          const next: Measured = {
            top: r.top,
            left: r.left,
            width: r.width,
            height: r.height,
            vw: window.innerWidth,
            vh: window.innerHeight,
          };
          // Only re-render when the geometry actually moved — this runs several times a second.
          setRect((prev) => (sameRect(prev, next) ? prev : next));
          // Bring an off-screen target into view once per step. Once, not every tick: repeating it
          // would fight the user the moment they scrolled anywhere themselves.
          if (!scrolledRef.current.has(stepKey) && (r.top < 0 || r.bottom > window.innerHeight)) {
            scrolledRef.current.add(stepKey);
            res.el.scrollIntoView({
              block: 'center',
              behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches
                ? 'auto'
                : 'smooth',
            });
          }
        } else {
          setRect(null);
        }
      }

      // `click` steps that open a dialog tick themselves the moment that dialog appears — that is
      // the one consequence of the user's click we can observe without touching their click.
      if (s.kind === 'click' && s.opensDialog && dialogByTitle(s.opensDialog)) {
        tick(stepKey, a.storyId, a.stepIdx);
      }

      if (s.kind === 'fill' && !filledRef.current.has(stepKey) && dialogByTitle(s.dialog)) {
        filledRef.current.add(stepKey);
        doFill(s);
      }
    }

    function doFill(fs: Extract<TourStep, { kind: 'fill' }>) {
      cancelVerify();
      const written: { el: HTMLInputElement | HTMLTextAreaElement; value: string }[] = [];
      for (const f of fs.fields) {
        const res = resolveField(f.field, fs.dialog);
        if (res.kind !== 'found') continue;
        const el = res.el;
        // Only plain text inputs are driven. `MSelect` and `MDatePicker` picks stay the user's job:
        // their menus portal to `document.body` and close on an outside click, and the catalogue
        // authors those as `check` steps for exactly that reason.
        if (!(el instanceof HTMLInputElement) && !(el instanceof HTMLTextAreaElement)) continue;
        setNativeValue(el, f.value);
        written.push({ el, value: f.value });
      }

      // Verify on a LATER frame, after React has had its render. If a value did not stick — a
      // component that normalises input, a field that was not really there, a dialog that remounted
      // under us — say so and hand the user the values to type. A silently false "done" on a step
      // that never happened is the worst outcome this component can produce, worse than not helping.
      verifyRaf.current = requestAnimationFrame(() => {
        verifyTimer.current = setTimeout(() => {
          const stuck =
            written.length === fs.fields.length &&
            written.every(({ el, value }) => el.value === value);
          if (stuck) {
            setFill({ status: 'filled' });
            tick(stepKey, a.storyId, a.stepIdx);
          } else {
            setFill({ status: 'manual', values: fs.fields });
          }
        }, 60);
      });
    }

    measure();
    const id = setInterval(measure, TICK_MS);
    // Capture phase: scrolling happens inside the app's own scroll containers, not on window, and
    // a non-capturing window listener never sees those.
    window.addEventListener('scroll', measure, true);
    window.addEventListener('resize', measure);
    return () => {
      clearInterval(id);
      window.removeEventListener('scroll', measure, true);
      window.removeEventListener('resize', measure);
    };
  }, [active, step, stepKey, lang, tick, cancelVerify]);

  // NOTE: the driver deliberately binds no Escape handler. `src/ui.tsx` keeps a module-level stack
  // of open dialogs so that only the topmost one answers Escape (a nested dialog must not close its
  // parent too); a window-level listener here would sit outside that stack and close the tour every
  // time the user dismissed a dialog. Stopping the tour is the Stop button, which is unambiguous.

  if (!active) return null;

  // --- language gate ---------------------------------------------------------------------------

  // Every selector in the catalogue IS an English UI string ('Save class', 'Topic name'), by design
  // — see the header of `shared/walkthrough.ts`. Under any other language the driver would resolve
  // nothing and quietly report every step as missing, which looks like a broken app rather than a
  // wrong setting. So it says so instead, and does nothing else. English literals are fine in this
  // file: it is an admin tool, and `src/dev-inspector.tsx` sets the same precedent.
  if (lang !== 'en') {
    return (
      <div className="tourd" data-tour-driver>
        <div className="tourd-coach tourd-coach--bottom" role="status">
          <div className="tourd-coach__text">
            The walkthrough only works in English — its targets are the English UI labels. Switch
            the language to English and press Run again.
          </div>
          <div className="tourd-coach__actions">
            <button type="button" className="tourd-btn" onClick={stop}>
              Stop
            </button>
          </div>
        </div>
      </div>
    );
  }

  if (!story || !step) {
    return (
      <div className="tourd" data-tour-driver>
        <div className="tourd-coach tourd-coach--bottom" role="status">
          <div className="tourd-coach__text">
            {!story
              ? `Unknown story "${active.storyId}".`
              : active.stepIdx >= story.steps.length
                ? `"${story.title}" — all ${story.steps.length} steps done.`
                : `This story has no step ${active.stepIdx + 1}.`}
          </div>
          <div className="tourd-coach__actions">
            <button type="button" className="tourd-btn" onClick={stop}>
              Stop
            </button>
          </div>
        </div>
      </div>
    );
  }

  // --- render ----------------------------------------------------------------------------------

  const hole = rect
    ? {
        top: Math.max(0, rect.top - PAD),
        left: Math.max(0, rect.left - PAD),
        right: Math.min(rect.vw, rect.left + rect.width + PAD),
        bottom: Math.min(rect.vh, rect.top + rect.height + PAD),
      }
    : null;

  // The bubble sits in the bottom band unless the target is down there, in which case it moves to
  // the top. The bubble is the ONE part of this overlay that takes pointer events, so it must never
  // come to rest on top of the control the user is being asked to press.
  const coachAtTop = hole != null && hole.bottom > (rect ? rect.vh : 0) - 220;

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(value);
    } catch {
      // Clipboard permission can be denied; the value is on screen either way.
    }
  };

  return (
    <div className="tourd" data-tour-driver>
      {/* Four rects around the target rather than one full-screen scrim with opacity: a single
          overlay would dim the very control it is pointing at. All of them are pointer-events:none
          — the dimming is guidance, not a lock, and the user must stay able to click anywhere. */}
      {hole && rect && (
        <>
          <div
            className="tourd-scrim"
            style={{ top: 0, left: 0, width: '100%', height: hole.top }}
          />
          <div
            className="tourd-scrim"
            style={{
              top: hole.bottom,
              left: 0,
              width: '100%',
              height: Math.max(0, rect.vh - hole.bottom),
            }}
          />
          <div
            className="tourd-scrim"
            style={{ top: hole.top, left: 0, width: hole.left, height: hole.bottom - hole.top }}
          />
          <div
            className="tourd-scrim"
            style={{
              top: hole.top,
              left: hole.right,
              width: Math.max(0, rect.vw - hole.right),
              height: hole.bottom - hole.top,
            }}
          />
          <div
            className="tourd-ring"
            style={{
              top: hole.top,
              left: hole.left,
              width: hole.right - hole.left,
              height: hole.bottom - hole.top,
            }}
          />
        </>
      )}

      <div
        className={'tourd-coach ' + (coachAtTop ? 'tourd-coach--top' : 'tourd-coach--bottom')}
        role="status"
      >
        <div className="tourd-coach__head">
          <span className="tourd-coach__step">
            Step {active.stepIdx + 1} of {story.steps.length}
          </span>
          <span className="tourd-coach__story">{story.title}</span>
        </div>
        <div className="tourd-coach__text">{step.text}</div>

        {status === 'ambiguous' && (
          <div className="tourd-coach__warn">
            {ambiguousCount} controls on this screen answer to that name, so the tour will not guess
            which one you mean. Find it yourself and carry on.
          </div>
        )}
        {status === 'missing' && step.kind !== 'goto' && (
          <div className="tourd-coach__warn">
            Waiting for that control to appear — it is not on screen yet.
          </div>
        )}

        {step.kind === 'goto' && story.account !== 'staff' && (
          <div className="tourd-coach__warn">
            This story is for the {story.account} account. Run only opened this window — it did not
            sign you in as one, so this step will not auto-tick no matter what is on screen. Sign in
            as {story.account} yourself in this window, then tick it by hand.
          </div>
        )}

        {step.kind === 'submit' && submitError && (
          <div className="tourd-coach__warn">
            The save reported an error: {submitError}. This step was not auto-ticked — fix it in
            the open dialog and press the button again, or press Next to tick it by hand anyway.
          </div>
        )}

        {step.kind === 'fill' && fill.status === 'manual' && (
          <div className="tourd-coach__warn">
            <div>The form did not accept the typed values. Enter them by hand:</div>
            <ul className="tourd-coach__values">
              {fill.values.map((f) => (
                <li key={f.field}>
                  <span className="tourd-coach__value-label">{f.field}</span>
                  <code>{f.value}</code>
                  <button
                    type="button"
                    className="tourd-btn tourd-btn--tiny"
                    onClick={() => copy(f.value)}
                  >
                    {copied === f.value ? 'copied ✓' : 'copy'}
                  </button>
                </li>
              ))}
            </ul>
          </div>
        )}

        <div className="tourd-coach__actions">
          <button
            type="button"
            className="tourd-btn"
            disabled={active.stepIdx === 0}
            onClick={() =>
              setActive((a) => (a ? { ...a, stepIdx: Math.max(0, a.stepIdx - 1) } : a))
            }
          >
            Back
          </button>
          {step.kind === 'fill' && (
            <button
              type="button"
              className="tourd-btn"
              onClick={() => {
                // Let the user ask for another attempt after they cleared or edited the dialog.
                filledRef.current.delete(stepKey);
                setFill({ status: 'idle' });
              }}
            >
              Fill again
            </button>
          )}
          <button
            type="button"
            className="tourd-btn tourd-btn--primary"
            onClick={() => tick(stepKey, active.storyId, active.stepIdx)}
          >
            Next
          </button>
          <button type="button" className="tourd-btn" onClick={stop}>
            Stop
          </button>
        </div>
      </div>
    </div>
  );
}
