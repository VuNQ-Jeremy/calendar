import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { PageHeader, useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { JOURNEYS, STORIES } from '../../shared/walkthrough.js';
import type { TourJourney, TourStep, TourStory } from '../../shared/walkthrough.js';
import { isTourMsg, openTourChannel } from './tour-channel.js';
import type { TourMsg } from './tour-channel.js';

/**
 * /walkthrough — the checklist half of the admin walkthrough.
 *
 * This is the window a person READS while walking the product. The other half is the tour driver
 * overlay (./tour-driver.tsx), which mounts in whatever window this screen opens with Run and
 * spotlights the control each step points at. The two talk over the BroadcastChannel in
 * ./tour-channel.ts; the 27 stories they both walk live in shared/walkthrough.ts.
 *
 * DIVISION OF LABOUR. This screen owns the RUN — which story is live, which step it is on, and what
 * has been ticked. The driver owns the SPOTLIGHT, and reports back with `tick` whenever it can
 * observe a step completing on its own (a dialog opened, a save round-tripped, a route was reached).
 * A tick therefore arrives here as a fact, and this screen answers with a `run` for the next step,
 * which is what moves the overlay along. When the driver cannot observe anything — a portalled menu,
 * a card that is its own click target — the catalogue writes the step as `check` and the human ticks
 * the box here by hand. Both routes into "done" end at the same checkbox.
 *
 * ENGLISH IS DATA HERE. Story titles, step text, tags and account names render straight out of
 * STORIES with no `t()` around them. That is not an oversight: those strings ARE the driver's
 * selectors (`{ button: 'Save class' }`), so they exist in exactly one language by design — see the
 * header of shared/walkthrough.ts. Only the screen's own chrome is translated.
 *
 * NOTHING HERE IS PERSISTED SERVER-SIDE, on purpose. See the docblock in app/routes/walkthrough.tsx.
 */

// ---------------------------------------------------------------------------------------------
// Progress
// ---------------------------------------------------------------------------------------------

/** Per-device notes for one person's run. The `_v1` suffix is there so a shape change can retire it. */
const WT_STORAGE_KEY = 'mochi_walkthrough_v1';

type Verdict = 'pass' | 'fail' | null;

interface StoryProgress {
  /** One boolean per step, indexed the same as `story.steps`. Short arrays read as all-false. */
  steps: boolean[];
  verdict: Verdict;
}

type Progress = Record<string, StoryProgress>;

/** The state a fresh load starts from, and what the server renders. */
const emptyProgress = (): Progress => ({});

const emptyStory = (): StoryProgress => ({ steps: [], verdict: null });

/**
 * Read whatever a previous run on this device left behind.
 *
 * Everything here is defensive because the input is a string the user can edit in devtools and a
 * shape a future version of this file may have changed: anything that is not what it should be is
 * dropped rather than thrown. A walkthrough that will not render because its own notes are
 * malformed is strictly worse than one that starts blank.
 */
function loadProgress(): Progress {
  try {
    const raw = localStorage.getItem(WT_STORAGE_KEY);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const out: Progress = {};
    for (const [id, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v !== 'object' || v === null) continue;
      const { steps, verdict } = v as { steps?: unknown; verdict?: unknown };
      out[id] = {
        steps: Array.isArray(steps) ? steps.map(Boolean) : [],
        verdict: verdict === 'pass' || verdict === 'fail' ? verdict : null,
      };
    }
    return out;
  } catch {
    // Storage disabled, quota, or unparseable JSON. Start blank.
    return {};
  }
}

function saveProgress(p: Progress) {
  try {
    localStorage.setItem(WT_STORAGE_KEY, JSON.stringify(p));
  } catch {
    /* storage unavailable — the ticks still work for the rest of this session */
  }
}

/** How many of `story`'s steps are ticked. Absent or short arrays count as not ticked. */
function doneCount(story: TourStory, p: Progress): number {
  const rec = p[story.id];
  if (!rec) return 0;
  return story.steps.reduce((n, _s, i) => n + (rec.steps[i] ? 1 : 0), 0);
}

// ---------------------------------------------------------------------------------------------
// The run
// ---------------------------------------------------------------------------------------------

interface RunState {
  /**
   * This tour's discriminator, minted fresh on every press of Run and handed to the opened window
   * as `?tour=<token>`. See the header of ./tour-channel.ts for why it exists at all: a
   * BroadcastChannel reaches EVERY same-origin tab, so without it a stale background tab already
   * sitting on the story's route would post a `tick` for a step no human performed — a step
   * silently marked done, which is the worst thing this feature could produce.
   */
  token: string;
  storyId: string;
  stepIdx: number;
  /** True once the opened window has said `ready`, i.e. a driver is really there listening. */
  connected: boolean;
}

/** `crypto.randomUUID` is available in every browser this app supports; the fallback is belt only. */
function mintToken(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `t${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`;
  }
}

// ---------------------------------------------------------------------------------------------
// Screen
// ---------------------------------------------------------------------------------------------

const ROLES: TourJourney['role'][] = ['Staff', 'Student', 'Parent'];

export function WalkthroughScreen() {
  const { t, lang } = useLang();

  const [progress, setProgress] = React.useState<Progress>(emptyProgress);
  /** `progress`, readable and writable synchronously. See `editStory` for why. */
  const progressRef = React.useRef<Progress>({});
  const [open, setOpen] = React.useState<ReadonlySet<string>>(() => new Set<string>());
  const [run, setRun] = React.useState<RunState | null>(null);
  const [blocked, setBlocked] = React.useState(false);

  /**
   * The live run, readable synchronously from the channel callback.
   *
   * That callback is registered once and closes over the state it saw then, and two ticks can land
   * inside one React batch — so reading `run` from the closure would answer with a stale step index
   * and post the driver back to a step the user had already finished. The ref is written at the
   * same moment as the state, so it is always the newest answer.
   */
  const runRef = React.useRef<RunState | null>(null);
  const postRef = React.useRef<(m: TourMsg) => void>(() => {});

  const setRunBoth = React.useCallback((next: RunState | null) => {
    runRef.current = next;
    setRun(next);
  }, []);

  // --- storage --------------------------------------------------------------------------------

  // Read in an effect rather than in the `useState` initialiser, for the reason LanguageProvider
  // (src/lib/i18n.tsx) and the slip theme (src/tuition/fee-slip.tsx) both do the same: this route
  // is server-rendered on Workers, where there is no localStorage, so an initialiser that read it
  // would make the first client render disagree with the server's HTML on every checkbox and every
  // progress bar. Server and first client render both start blank; the notes arrive a tick later.
  React.useEffect(() => {
    const stored = loadProgress();
    progressRef.current = stored;
    setProgress(stored);
  }, []);

  /**
   * Apply a change to one story's notes, then persist.
   *
   * The write is a plain statement here, NOT a line inside a `setProgress` updater. A state updater
   * must be a pure function of the previous state — React invokes it twice under StrictMode and may
   * invoke it again for a render it discards — so a localStorage write in there fires more often
   * than the change it is recording. It happens to be idempotent today, which is precisely why it
   * is worth not seeding: the shape is wrong, not the current behaviour.
   *
   * An effect on `progress` was the other option and is worse here, because the load above is
   * itself an effect: under StrictMode's mount/unmount/mount the persist effect gets a second run
   * in the commit where `progress` is still the empty starting map, and writes that over the notes
   * the load has only just scheduled. Computing the next value against a ref sidesteps both — and
   * it is the same ref-beside-state pattern `runRef` uses a few lines down, for the same reason:
   * ticks can arrive several to a batch, and each one has to see the previous one's result.
   */
  const editStory = React.useCallback(
    (storyId: string, fn: (rec: StoryProgress) => StoryProgress) => {
      const prev = progressRef.current;
      const next: Progress = { ...prev, [storyId]: fn(prev[storyId] ?? emptyStory()) };
      progressRef.current = next;
      setProgress(next);
      saveProgress(next);
    },
    [],
  );

  const setStep = React.useCallback(
    (storyId: string, idx: number, value: boolean) => {
      editStory(storyId, (rec) => {
        const steps = [...rec.steps];
        // Pad rather than assume: notes stored before a step was added to the catalogue are short.
        while (steps.length <= idx) steps.push(false);
        steps[idx] = value;
        return { ...rec, steps };
      });
    },
    [editStory],
  );

  const setVerdict = React.useCallback(
    (storyId: string, verdict: Exclude<Verdict, null>) => {
      // Pressing the verdict a story already holds clears it, so a misclick costs one click to undo.
      editStory(storyId, (rec) => ({ ...rec, verdict: rec.verdict === verdict ? null : verdict }));
    },
    [editStory],
  );

  // The app's own confirm dialog (src/ui.tsx), not the browser's. A native `confirm()` is the one
  // element that would make this read as a debug page rather than a Mochi screen — and it is the
  // only such call in src/. `useConfirm` returns the dialog node to render; see the JSX below.
  const [confirm, confirmNode] = useConfirm();
  const reset = React.useCallback(async () => {
    const ok = await confirm({
      title: t('wt_reset_q'),
      message: t('wt_reset_confirm'),
      confirmLabel: t('wt_reset'),
      danger: true,
    });
    if (!ok) return;
    // Remove the key rather than store an empty map, so a device whose walkthrough has been reset
    // leaves nothing behind at all — the same choice `useCollapsedSections` makes in
    // src/lib/sidebar-nav.tsx.
    try {
      localStorage.removeItem(WT_STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
    progressRef.current = {};
    setProgress({});
  }, [confirm, t]);

  // --- channel --------------------------------------------------------------------------------

  React.useEffect(() => {
    const ch = openTourChannel((raw: unknown) => {
      // `openTourChannel` hands over `ev.data` untouched and a BroadcastChannel is keyed only by a
      // NAME, so anything same-origin can put junk on it. Narrow with the driver's own predicate —
      // one definition, so the two ends of the protocol cannot drift apart on what is valid.
      if (!isTourMsg(raw)) return;
      const cur = runRef.current;

      if (raw.t === 'hello') {
        // A freshly-opened (or reloaded) tour window asking what is running. Only this screen
        // knows. This answer, not the `run` posted by the Run handler, is what actually starts most
        // tours: the new window takes a moment to boot, and nothing was listening when Run fired.
        if (cur) {
          postRef.current({
            t: 'run',
            token: cur.token,
            storyId: cur.storyId,
            stepIdx: cur.stepIdx,
          });
        }
        return;
      }

      if (raw.t === 'stop') {
        // Bidirectional (see ./tour-channel.ts): the driver posts this when the user presses Stop
        // in the coach bubble. It carries no token because ending a tour that is already over is a
        // no-op. Without handling it, the checklist would go on showing a tour nobody is running.
        setRunBoth(null);
        return;
      }

      // Everything below carries a token, and is ours only if it matches the tour WE started. A
      // message on another token is another window's business — most likely a tab left open from an
      // earlier run, which is precisely what the token exists to keep out.
      if (!cur || raw.token !== cur.token || raw.storyId !== cur.storyId) return;

      if (raw.t === 'ready') {
        setRunBoth({ ...cur, connected: true });
        return;
      }

      if (raw.t === 'tick') {
        const story = STORIES.find((s) => s.id === cur.storyId);
        if (!story || raw.stepIdx < 0 || raw.stepIdx >= story.steps.length) return;
        setStep(cur.storyId, raw.stepIdx, true);
        // Never move backwards. Ticks can arrive out of order — the driver's Back button lets the
        // user re-do a step it has already reported — and a run that walked backwards would send
        // the overlay to a control the user has long since moved past.
        const next = Math.max(cur.stepIdx, raw.stepIdx + 1);
        const state: RunState = { ...cur, stepIdx: next, connected: true };
        setRunBoth(state);
        postRef.current({ t: 'run', token: state.token, storyId: state.storyId, stepIdx: next });
      }
      // `run` is this screen's own outbound vocabulary; one arriving here came from a second
      // checklist window and is none of our business.
    });
    postRef.current = ch.post;
    return () => {
      postRef.current = () => {};
      ch.close();
    };
  }, [setRunBoth, setStep]);

  // --- run / stop -----------------------------------------------------------------------------

  const startRun = React.useCallback(
    (story: TourStory) => {
      setBlocked(false);
      // End whatever was running first. `stop` carries no token, so this reaches every driver
      // window — including one left open from an earlier Run, whose overlay would otherwise keep
      // painting over a tour that is finished. It cannot reach us: a BroadcastChannel never
      // delivers a message back to the object that posted it.
      postRef.current({ t: 'stop' });

      // A fresh token on every press. This is what keeps Run re-pressable, and re-pressable Run is
      // the recovery path for the one way a tour ends by accident: a hard reload of the tour window
      // drops the `?tour=` param, so that window stops being a tour window at all and goes inert.
      // Pressing Run again mints a new token and opens a new window, and nothing left over from the
      // old run can answer to it — no stale state to clear first, by construction. Which is why the
      // card keeps its Run button for the whole of a run (see StoryCard): the checklist cannot tell
      // a live tour window from one that died, so the recovery has to be offered unconditionally.
      const token = mintToken();
      const w = window.open(`${story.route}?tour=${token}`, '_blank');
      if (!w) {
        // Pop-up blocked: NOTHING is running, so no run state is set. Setting it here would put the
        // card into its running treatment for a window that does not exist — and, before this was
        // fixed, replaced Run with Stop, contradicting the very message we are about to show.
        setBlocked(true);
        return;
      }

      const state: RunState = { token, storyId: story.id, stepIdx: 0, connected: false };
      setRunBoth(state);
      // Posted immediately as well as on `hello`: a no-op if the new window is still booting and
      // nothing is listening yet, and correct if the browser reused a window already on that route.
      postRef.current({ t: 'run', token, storyId: story.id, stepIdx: 0 });
    },
    [setRunBoth],
  );

  const stopRun = React.useCallback(() => {
    postRef.current({ t: 'stop' });
    setRunBoth(null);
  }, [setRunBoth]);

  // --- derived --------------------------------------------------------------------------------

  const toggleOpen = React.useCallback((id: string) => {
    setOpen((prev) => {
      const next = new Set(prev);
      if (!next.delete(id)) next.add(id);
      return next;
    });
  }, []);

  const allSteps = STORIES.reduce((n, s) => n + s.steps.length, 0);
  const allDone = STORIES.reduce((n, s) => n + doneCount(s, progress), 0);

  return (
    <div className="content">
      <PageHeader
        title={t('nav_walkthrough')}
        subtitle={t('wt_subtitle')}
        actions={
          <div className="wt-head-meter">
            <div className="wt-head-meter__row">
              <span>{t('wt_overall')}</span>
              <span className="wt-head-meter__count">
                {t('wt_progress', { done: allDone, total: allSteps })}
              </span>
            </div>
            <DS.ProgressBar
              value={allSteps === 0 ? 0 : (allDone / allSteps) * 100}
              color={allSteps > 0 && allDone === allSteps ? 'green' : 'brand'}
            />
            <DS.Button size="sm" variant="ghost" onClick={reset}>
              {t('wt_reset')}
            </DS.Button>
          </div>
        }
      />

      {/* The driver refuses to run under any other language — its targets are the English labels —
          and it does say so, but only in the coach bubble, by which point the user has opened a
          window and walked to it. Saying it here, beside the button, is the version that saves the
          trip. */}
      {lang !== 'en' && <div className="wt-notice wt-notice--warn">{t('wt_english_only')}</div>}
      {blocked && <div className="wt-notice wt-notice--danger">{t('wt_popup_blocked')}</div>}

      {ROLES.map((role) => {
        const journeys = JOURNEYS.filter((j) => j.role === role);
        if (journeys.length === 0) return null;
        return (
          <section className="wt-role" key={role}>
            <h2 className="wt-role__title">{role}</h2>
            {journeys.map((journey) => (
              <JourneyBlock
                key={journey.id}
                journey={journey}
                progress={progress}
                open={open}
                run={run}
                onToggle={toggleOpen}
                onRun={startRun}
                onStop={stopRun}
                onStep={setStep}
                onVerdict={setVerdict}
              />
            ))}
          </section>
        );
      })}

      {confirmNode}
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Journey
// ---------------------------------------------------------------------------------------------

interface BlockProps {
  journey: TourJourney;
  progress: Progress;
  open: ReadonlySet<string>;
  run: RunState | null;
  onToggle: (id: string) => void;
  onRun: (story: TourStory) => void;
  onStop: () => void;
  onStep: (storyId: string, idx: number, value: boolean) => void;
  onVerdict: (storyId: string, verdict: 'pass' | 'fail') => void;
}

function JourneyBlock(props: BlockProps) {
  const { journey, progress, open, run } = props;
  const { t } = useLang();
  const stories = STORIES.filter((s) => s.journey === journey.id);
  const total = stories.reduce((n, s) => n + s.steps.length, 0);
  const done = stories.reduce((n, s) => n + doneCount(s, progress), 0);
  const complete = total > 0 && done === total;

  return (
    <div className="wt-journey">
      <div className="wt-journey__head">
        <div className="wt-journey__id">
          <h3 className="wt-journey__title">{journey.title}</h3>
          <p className="wt-journey__desc">{journey.desc}</p>
        </div>
        <div className="wt-journey__meter">
          <span className="wt-journey__count">{t('wt_progress', { done, total })}</span>
          <DS.ProgressBar
            value={total === 0 ? 0 : (done / total) * 100}
            color={complete ? 'green' : 'brand'}
          />
        </div>
      </div>
      <div className="wt-stories">
        {stories.map((story) => (
          <StoryCard
            key={story.id}
            story={story}
            rec={progress[story.id] ?? emptyStory()}
            open={open.has(story.id)}
            // The run, but only when it belongs to THIS story — so a card never has to ask whose
            // tour it is looking at.
            run={run && run.storyId === story.id ? run : null}
            onToggle={props.onToggle}
            onRun={props.onRun}
            onStop={props.onStop}
            onStep={props.onStep}
            onVerdict={props.onVerdict}
          />
        ))}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------------------------
// Story
// ---------------------------------------------------------------------------------------------

interface CardProps {
  story: TourStory;
  rec: StoryProgress;
  open: boolean;
  run: RunState | null;
  onToggle: (id: string) => void;
  onRun: (story: TourStory) => void;
  onStop: () => void;
  onStep: (storyId: string, idx: number, value: boolean) => void;
  onVerdict: (storyId: string, verdict: 'pass' | 'fail') => void;
}

/** The word on a step's kind chip. `goto` reads better as "open" to someone following along. */
const KIND_LABEL: Record<TourStep['kind'], string> = {
  goto: 'open',
  click: 'click',
  fill: 'fill',
  submit: 'save',
  check: 'check',
};

function StoryCard(props: CardProps) {
  const { story, rec, open, run } = props;
  const { t } = useLang();
  const done = story.steps.reduce((n, _s, i) => n + (rec.steps[i] ? 1 : 0), 0);
  // Story ids are the catalogue's own kebab-case keys and unique across all 27, so they make a
  // valid, stable DOM id without a `useId` — and a stable one matters: `aria-controls` has to keep
  // pointing at the same node across the expand/collapse this button drives.
  const bodyId = `wt-body-${story.id}`;

  return (
    <DS.Card
      className={[
        'wt-story',
        open ? 'is-open' : '',
        run ? 'is-running' : '',
        rec.verdict ? `is-${rec.verdict}` : '',
      ]
        .filter(Boolean)
        .join(' ')}
    >
      <div className="wt-story__head">
        <button
          type="button"
          className="wt-story__toggle"
          aria-expanded={open}
          aria-controls={bodyId}
          onClick={() => props.onToggle(story.id)}
        >
          <MIcon name="chevronRight" size={14} className="wt-story__chev" />
          <span className="wt-story__title">{story.title}</span>
        </button>

        {/* Tag and account are DATA, not chrome (see the file header). The tag is the one that has
            to carry weight: `caution` marks the stories that touch live attendance, grades and
            money, so it gets the danger palette rather than a third neutral pill. The account says
            which login to be holding before you press Run. */}
        <span className={`wt-tag wt-tag--${story.tag}`}>{story.tag}</span>
        <span className="wt-acct">{story.account}</span>
        <span className="wt-story__count">
          {t('wt_progress', { done, total: story.steps.length })}
        </span>

        {/* Run is ALWAYS on the card, running or not, and Stop only joins it during a run.
            The checklist cannot tell a live tour window from a dead one: the driver goes inert on a
            hard reload (that drops the `?tour=` param) and says nothing when the window is closed,
            so `run` can outlive the thing it describes. Swapping Run out for Stop during a run made
            the one-click recovery — press Run again, mint a new token, open a new window — the one
            thing the screen did not offer, and contradicted `wt_popup_blocked`, which says exactly
            that. Stop is still worth having: it is how you end a tour without starting another. */}
        {run && (
          <DS.Button size="sm" variant="secondary" onClick={props.onStop}>
            {t('wt_stop')}
          </DS.Button>
        )}
        <DS.Button size="sm" variant="primary" onClick={() => props.onRun(story)}>
          {t('wt_run')}
        </DS.Button>
      </div>

      {run && (
        <div className="wt-story__live" role="status">
          <span className="wt-live-dot" aria-hidden="true" />
          <span>
            {t('wt_running')} · {story.route}
          </span>
          {/* Until the second window says `ready` we do not know a driver is there at all — the
              window may still be booting, or the user may have closed it. Showing that honestly
              beats a live dot that means nothing. */}
          {!run.connected && <span className="wt-story__live-wait">…</span>}
        </div>
      )}

      {open && (
        <div className="wt-story__body" id={bodyId}>
          <div className="wt-specs">
            {story.specs.length > 0 ? (
              <>
                <span className="wt-specs__label">{t('wt_specs')}</span>
                {story.specs.map((spec) => (
                  <code className="wt-spec" key={spec}>
                    {spec}
                  </code>
                ))}
              </>
            ) : (
              /* Not an error. The catalogue marks a story with no e2e spec behind it so the
                 coverage gap is visible while you walk it — those are the stories worth being
                 slow and suspicious about, because nothing else is watching them. */
              <span className="wt-spec wt-spec--none">{t('wt_no_spec')}</span>
            )}
          </div>

          <ol className="wt-steps">
            {story.steps.map((step, i) => (
              <li
                key={`${story.id}:${i}`}
                className={[
                  'wt-step',
                  rec.steps[i] ? 'is-done' : '',
                  run && run.stepIdx === i ? 'is-current' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
              >
                <span className="wt-step__n">{i + 1}</span>
                <span className={`wt-kind wt-kind--${step.kind}`}>{KIND_LABEL[step.kind]}</span>
                <DS.Checkbox
                  className="wt-step__check"
                  checked={Boolean(rec.steps[i])}
                  label={step.text}
                  onChange={(e) => props.onStep(story.id, i, e.currentTarget.checked)}
                />
              </li>
            ))}
          </ol>

          <div className="wt-verdict">
            <DS.Button
              size="sm"
              variant={rec.verdict === 'pass' ? 'primary' : 'secondary'}
              onClick={() => props.onVerdict(story.id, 'pass')}
            >
              {t('wt_pass')}
            </DS.Button>
            <DS.Button
              size="sm"
              variant={rec.verdict === 'fail' ? 'danger' : 'secondary'}
              onClick={() => props.onVerdict(story.id, 'fail')}
            >
              {t('wt_fail')}
            </DS.Button>
          </div>
        </div>
      )}
    </DS.Card>
  );
}
