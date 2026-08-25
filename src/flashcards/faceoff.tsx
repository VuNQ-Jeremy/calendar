import React from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MSelect, useConfirm } from '../ui.jsx';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { buildQuizQuestions, type QuizQuestion } from '../../shared/logic/flashcards';
import {
  faceoffAnswer,
  newFaceoff,
  newRace,
  raceAnswer,
  raceTimeUp,
  FACEOFF_MAX_QUESTIONS,
  FACEOFF_TARGET,
  RACE_DEFAULT_QUESTIONS,
  RACE_DEFAULT_SECONDS,
  RACE_QUESTION_COUNTS,
  RACE_SECONDS_CHOICES,
  type FaceoffSide,
  type FaceoffState,
  type RaceState,
} from '../../shared/logic/pvp';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

type LoaderData = {
  topic: { id: string; name: string; slug: string | null };
  words: FlashcardWordRow[];
  students: { id: string; name: string }[];
  isStaff: boolean;
};

type Question = QuizQuestion<FlashcardWordRow>;

/** Which game the two players picked on the setup step. */
type FaceoffMode = 'duel' | 'race';

/**
 * The tabletop 1v1 face-off. The tablet lies flat with a player at each SHORT edge; the
 * letter tops must point AWAY from the player who reads them, so the left half is rotated
 * +90deg (tops point right, toward the left-edge player) and the right half -90deg (tops
 * point left) — each reads their own board upright while the opponent's runs sideways, by
 * design. No networking: one client builds the questions and runs the whole match, because
 * there is only one device.
 *
 * Two games share this screen, chosen on the setup step:
 *   - Duel  — one shared question, first to FACEOFF_TARGET points; a wrong tap sits out the
 *     rest of that question (`FaceoffState` / `faceoffAnswer`).
 *   - Race  — each side runs the SAME question list at its own position against one shared
 *     countdown; a wrong tap costs only the tapper (`RaceState` / `raceAnswer`).
 * The two reducers stay separate on purpose: Duel has a single shared question index, Race
 * has one per side, so there is no honest way to fold them into one state shape.
 */
export function FaceoffScreen() {
  const { topic, words, students, isStaff } = useLoaderData() as LoaderData;
  const { t } = useLang();
  const navigate = useNavigate();
  const resultFetcher = useFetcher();
  const [confirm, confirmNode] = useConfirm();
  const topicPath = topic.slug ?? topic.id;

  const [step, setStep] = React.useState<'setup' | 'play' | 'finish'>('setup');
  const [player1, setPlayer1] = React.useState<{ id: string; name: string } | null>(null);
  const [player2, setPlayer2] = React.useState<{ id: string; name: string } | null>(null);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [mode, setMode] = React.useState<FaceoffMode>('duel');
  const [state, setState] = React.useState<FaceoffState>(newFaceoff());
  // Race only. `deadline` is epoch ms; `now` is what the countdown ticks so the clock and the
  // per-side cooldowns re-render.
  const [raceCount, setRaceCount] = React.useState<number>(RACE_DEFAULT_QUESTIONS);
  const [raceSeconds, setRaceSeconds] = React.useState<number>(RACE_DEFAULT_SECONDS);
  const [race, setRace] = React.useState<RaceState>(() => newRace(RACE_DEFAULT_QUESTIONS));
  const [deadline, setDeadline] = React.useState<number | null>(null);
  const [now, setNow] = React.useState<number>(() => Date.now());
  const posted = React.useRef(false);

  // Also the rematch handler — the mode and its pickers survive a match, so a rematch is just
  // another start.
  const start = () => {
    posted.current = false;
    if (mode === 'race') {
      // buildQuizQuestions caps the round at the DECK size, so a 6-word topic yields 6 questions
      // even when 10 were asked for. Seed the race from questions.length, never from the picker,
      // or totalQuestions promises a question that is not there.
      const qs = buildQuizQuestions(words, raceCount);
      setQuestions(qs);
      setRace(newRace(qs.length));
      setNow(Date.now());
      setDeadline(Date.now() + raceSeconds * 1000);
    } else {
      setQuestions(buildQuizQuestions(words, FACEOFF_MAX_QUESTIONS));
      setState(newFaceoff());
      setDeadline(null);
    }
    setStep('play');
  };

  const answerDuel = (side: FaceoffSide, option: string) => {
    const q = questions[state.qIndex];
    if (!q) return;
    const next = faceoffAnswer(state, side, option === q.answer, questions.length);
    setState(next);
    if (next.finished) setStep('finish');
  };

  const answerRace = (side: FaceoffSide, option: string) => {
    // The tick that settles the expiry is 200ms wide, so `race.finished` alone would let a tap
    // land after the buzzer and steal the win. Check the clock itself, not the state it drives.
    if (deadline !== null && Date.now() >= deadline) return;
    const q = questions[race.progress[side]];
    if (!q) return;
    setRace((r) => raceAnswer(r, side, option === q.answer, Date.now()));
  };

  const answer = (side: FaceoffSide, option: string) =>
    mode === 'race' ? answerRace(side, option) : answerDuel(side, option);

  // Abandoning forfeits a match in progress, so both the on-screen control and Escape route
  // through the same confirm rather than navigating straight away.
  const confirmPending = React.useRef(false);
  const quit = React.useCallback(async () => {
    // Modal's own Escape handler also closes the confirm on the same keydown that would
    // otherwise re-open it via the listener below — guard against re-entering while one is
    // already showing, or Escape can never dismiss it (see faceoff.tsx history).
    if (confirmPending.current) return;
    confirmPending.current = true;
    try {
      const ok = await confirm({
        title: t('pvp_faceoff_quit'),
        message: t('pvp_faceoff_quit_msg'),
        confirmLabel: t('fc_exit'),
        danger: true,
      });
      if (ok) navigate(`/vocabulary/${topicPath}`);
    } finally {
      confirmPending.current = false;
    }
  }, [confirm, navigate, t, topicPath]);

  React.useEffect(() => {
    if (step !== 'play') return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') quit();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [step, quit]);

  // Race's countdown. One interval drives both the clock and the per-side cooldown expiry.
  React.useEffect(() => {
    if (step !== 'play' || mode !== 'race' || deadline === null) return;
    const id = setInterval(() => {
      setNow(Date.now());
      // raceTimeUp returns the same object once finished, so a double tick cannot double-settle.
      if (Date.now() >= deadline) setRace((r) => raceTimeUp(r));
    }, 200);
    return () => clearInterval(id);
  }, [step, mode, deadline]);

  // Both Race endings — someone finished the list, or the clock ran out — set `finished`, so one
  // effect moves to the finish step for either.
  React.useEffect(() => {
    if (step !== 'play' || mode !== 'race') return;
    if (race.finished) setStep('finish');
  }, [step, mode, race.finished]);

  // The finish step and the result post read one shape for both games: Duel scores points,
  // Race counts questions cleared.
  const winner = mode === 'race' ? race.winner : state.winner;
  const counts = mode === 'race' ? race.progress : state.scores;
  const total = mode === 'race' ? race.totalQuestions : questions.length;

  React.useEffect(() => {
    if (step !== 'finish' || posted.current) return;
    if (winner === null) return; // a draw is never recorded
    if (!player1 || !player2) return; // anonymous quick-play records nothing
    posted.current = true;
    const winnerId = winner === 1 ? player1.id : player2.id;
    const loserId = winner === 1 ? player2.id : player1.id;
    const winnerScore = winner === 1 ? counts[1] : counts[2];
    const loserScore = winner === 1 ? counts[2] : counts[1];
    const fd = new FormData();
    fd.set('intent', 'faceoff-result');
    // The two vocabularies are deliberately separate on the ladder, so the wire value is not the
    // UI-level mode string.
    fd.set('mode', mode === 'race' ? 'quiz-race' : 'quiz-faceoff');
    fd.set('topicId', topic.id);
    fd.set('winnerStudentId', winnerId);
    fd.set('loserStudentId', loserId);
    fd.set('winnerScore', String(winnerScore));
    fd.set('loserScore', String(loserScore));
    fd.set('total', String(total));
    resultFetcher.submit(fd, { method: 'post', action: '/game-rooms' });
  }, [step, winner, counts, total, player1, player2, topic.id, mode, resultFetcher]);

  if (step === 'setup') {
    return (
      <FullBleed>
        <div
          style={{
            display: 'flex',
            flexDirection: 'column',
            gap: 20,
            alignItems: 'center',
            maxWidth: 480,
          }}
        >
          <div style={{ fontSize: 24, fontWeight: 800 }}>{t('pvp_faceoff_title')}</div>
          <div style={{ color: 'var(--text-muted)' }}>{topic.name}</div>
          <div className="m-stack" style={{ gap: 10, width: '100%' }}>
            <ModeRow
              selected={mode === 'duel'}
              title={t('pvp_faceoff_mode_duel')}
              sub={t('pvp_faceoff_mode_duel_sub')}
              onClick={() => setMode('duel')}
            />
            <ModeRow
              selected={mode === 'race'}
              title={t('pvp_faceoff_mode_race')}
              sub={t('pvp_faceoff_mode_race_sub')}
              onClick={() => setMode('race')}
            />
          </div>
          {mode === 'race' && (
            <>
              <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('fc_round_size')}:</span>
                {RACE_QUESTION_COUNTS.map((n) => (
                  <FBtn
                    key={n}
                    variant={raceCount === n ? 'primary' : 'soft'}
                    onClick={() => setRaceCount(n)}
                  >
                    {n}
                  </FBtn>
                ))}
              </div>
              <div className="m-row" style={{ gap: 8, alignItems: 'center' }}>
                <span style={{ color: 'var(--text-muted)' }}>{t('pvp_race_duration')}:</span>
                {RACE_SECONDS_CHOICES.map((n) => (
                  <FBtn
                    key={n}
                    variant={raceSeconds === n ? 'primary' : 'soft'}
                    onClick={() => setRaceSeconds(n)}
                  >
                    {n}s
                  </FBtn>
                ))}
              </div>
            </>
          )}
          {isStaff && (
            <>
              <MSelect
                label={t('pvp_player_1')}
                value={player1?.id ?? ''}
                onChange={(v) => setPlayer1(students.find((s) => s.id === v) ?? null)}
                options={[
                  { value: '', label: t('pvp_pick_student') },
                  ...students.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
              <MSelect
                label={t('pvp_player_2')}
                value={player2?.id ?? ''}
                onChange={(v) => setPlayer2(students.find((s) => s.id === v) ?? null)}
                options={[
                  { value: '', label: t('pvp_pick_student') },
                  ...students.map((s) => ({ value: s.id, label: s.name })),
                ]}
              />
            </>
          )}
          {mode === 'duel' && (
            <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
              {t('pvp_faceoff_rule', { n: FACEOFF_TARGET })}
            </div>
          )}
          <FBtn variant="primary" size="lg" onClick={start}>
            {t('pvp_start')}
          </FBtn>
          <FBtn variant="ghost" onClick={() => navigate(`/vocabulary/${topicPath}`)}>
            {t('fc_exit')}
          </FBtn>
        </div>
      </FullBleed>
    );
  }

  if (step === 'finish') {
    return (
      <FullBleed>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 20, alignItems: 'center' }}>
          <div style={{ fontSize: 28, fontWeight: 800 }}>
            {winner === null
              ? t('pvp_draw')
              : t('pvp_winner', {
                  name:
                    winner === 1
                      ? (player1?.name ?? t('pvp_player_1'))
                      : (player2?.name ?? t('pvp_player_2')),
                })}
          </div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 20 }}>
            {counts[1]} — {counts[2]}
          </div>
          <div className="m-row" style={{ gap: 10 }}>
            <FBtn variant="primary" onClick={start}>
              {t('pvp_rematch')}
            </FBtn>
            <FBtn variant="secondary" onClick={() => navigate(`/vocabulary/${topicPath}`)}>
              {t('done')}
            </FBtn>
          </div>
        </div>
      </FullBleed>
    );
  }

  const isRace = mode === 'race';
  // Duel shows both players the same question; Race hands each half the one at its own progress.
  const questionFor = (side: FaceoffSide) =>
    isRace ? questions[race.progress[side]] : questions[state.qIndex];
  const blockedFor = (side: FaceoffSide) =>
    isRace ? now < race.blockedUntil[side] : state.locked[side];
  const blockedLabel = isRace ? t('pvp_race_cooldown') : t('pvp_faceoff_locked');
  // Duel fills toward the point target, Race toward the end of its list.
  const fillDenominator = isRace ? Math.max(1, race.totalQuestions) : FACEOFF_TARGET;
  const secondsLeft =
    deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Math.min(now, deadline)) / 1000));
  const centerLabel = isRace
    ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
    : `${state.qIndex + 1}/${questions.length}`;

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-app, #faf7f2)',
        display: 'flex',
        flexDirection: 'row',
      }}
    >
      <FaceoffHalf
        side={1}
        rotateDeg={90}
        question={questionFor(1)}
        blocked={blockedFor(1)}
        blockedLabel={blockedLabel}
        onAnswer={(opt) => answer(1, opt)}
        name={player1?.name}
      />
      <Divider
        fill1={counts[1] / fillDenominator}
        fill2={counts[2] / fillDenominator}
        count1={counts[1]}
        count2={counts[2]}
        centerLabel={centerLabel}
        onQuit={quit}
      />
      <FaceoffHalf
        side={2}
        rotateDeg={-90}
        question={questionFor(2)}
        blocked={blockedFor(2)}
        blockedLabel={blockedLabel}
        onAnswer={(opt) => answer(2, opt)}
        name={player2?.name}
      />
      {confirmNode}
    </div>
  );
}

/**
 * One large option row on the setup step — same shape as the Battle dialog's room/face-off
 * choice, with a second line because these two games need explaining before a tap.
 */
function ModeRow({
  selected,
  title,
  sub,
  onClick,
}: {
  selected: boolean;
  title: string;
  sub: string;
  onClick: () => void;
}) {
  return (
    <FBtn
      variant={selected ? 'primary' : 'soft'}
      size="lg"
      block={true}
      aria-pressed={selected}
      onClick={onClick}
      // .mochi-btn is a single-line pill: `white-space: nowrap`, `line-height: 1` and a fixed
      // 52px height on .is-lg (ds/styles/tokens/components.css). A two-line label needs all three
      // relaxed, or an ~80-character sub renders as one line straight out of the 480px column.
      style={{ height: 'auto', minHeight: 52, paddingTop: 10, paddingBottom: 10 }}
    >
      <span
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 2,
          textAlign: 'left',
          whiteSpace: 'normal',
          lineHeight: 1.3,
        }}
      >
        <span style={{ fontWeight: 800 }}>{title}</span>
        <span style={{ fontSize: 13, fontWeight: 500, opacity: 0.75 }}>{sub}</span>
      </span>
    </FBtn>
  );
}

function FullBleed({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-app, #faf7f2)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        padding: 24,
        fontFamily: 'var(--font-body)',
      }}
    >
      {children}
    </div>
  );
}

/**
 * The unrotated strip between the two halves: a label both players can read sideways, a fill bar
 * per side, the numeric pair, and the only way out of a match in progress.
 *
 * It computes nothing about either game — the caller passes the fills already normalised to 0..1
 * (Duel: points / FACEOFF_TARGET; Race: questions cleared / total) so one strip serves both.
 */
function Divider({
  fill1,
  fill2,
  count1,
  count2,
  centerLabel,
  onQuit,
}: {
  /** 0..1 — clamped here, so an over-target duel score cannot overflow the track. */
  fill1: number;
  fill2: number;
  /** The raw numbers under the bars: Duel points, or Race questions cleared. */
  count1: number;
  count2: number;
  /** Duel: "3/13". Race: the countdown. */
  centerLabel: string;
  onQuit: () => void;
}) {
  const { t } = useLang();
  return (
    <div
      style={{
        width: 66,
        flexShrink: 0,
        background: 'var(--surface-sunken, #fdf6ec)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        padding: '14px 0',
      }}
    >
      <div
        style={{
          fontFamily: 'var(--font-mono, monospace)',
          fontSize: 13,
          color: 'var(--text-muted)',
        }}
      >
        {centerLabel}
      </div>
      <div style={{ flex: 1, display: 'flex', gap: 3, padding: '12px 0' }}>
        <div
          style={{
            width: 17,
            background: 'var(--surface-hover, #f2e9db)',
            borderRadius: 999,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            style={{
              height: `${Math.min(100, Math.max(0, fill1) * 100)}%`,
              background: 'var(--cat-violet-base, #a185e4)',
              borderRadius: 999,
            }}
          />
        </div>
        <div
          style={{
            width: 17,
            background: 'var(--surface-hover, #f2e9db)',
            borderRadius: 999,
            display: 'flex',
            flexDirection: 'column',
            justifyContent: 'flex-end',
          }}
        >
          <div
            style={{
              height: `${Math.min(100, Math.max(0, fill2) * 100)}%`,
              background: 'var(--cat-green-base, #6fb97a)',
              borderRadius: 999,
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, fontWeight: 800 }}>
        <span>{count1}</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span>{count2}</span>
      </div>
      <button
        type="button"
        onClick={onQuit}
        aria-label={t('pvp_faceoff_quit')}
        style={{
          marginTop: 14,
          width: 44,
          height: 44,
          minWidth: 44,
          minHeight: 44,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          border: 'none',
          background: 'transparent',
          color: 'var(--text-muted)',
          cursor: 'pointer',
          borderRadius: 999,
        }}
      >
        <MIcon name="x" size={20} />
      </button>
    </div>
  );
}

/**
 * One player's rotated board. `question` is per-side on purpose: Duel hands both halves the same
 * one, Race hands each the question at its own progress.
 */
function FaceoffHalf({
  side,
  rotateDeg,
  question,
  blocked,
  blockedLabel,
  onAnswer,
  name,
}: {
  side: FaceoffSide;
  rotateDeg: number;
  question: Question | undefined;
  /** This side's taps are ignored: Duel's until-next-question lock, or Race's own cooldown. */
  blocked: boolean;
  /** Why, in this game's words — the two games block for different reasons. */
  blockedLabel: string;
  onAnswer: (option: string) => void;
  name?: string;
}) {
  if (!question) return <div style={{ flex: 1 }} />;
  return (
    // data-side, not a visual hook — it is what lets the e2e spec tell the two identical-text
    // halves apart (e2e/pvp.spec.ts).
    <div data-side={side} style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
      <div
        style={{
          position: 'absolute',
          top: '50%',
          left: '50%',
          width: '100vh',
          height: 'calc((100vw - 66px) / 2)',
          transform: `translate(-50%, -50%) rotate(${rotateDeg}deg)`,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          gap: 20,
          padding: '24px 40px',
          opacity: blocked ? 0.45 : 1,
        }}
      >
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          {name && <span style={{ fontWeight: 800 }}>{name}</span>}
          <span style={{ fontSize: 36, fontWeight: 800 }}>{question.word.word}</span>
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 1fr',
            gap: 14,
            width: '100%',
            maxWidth: 700,
          }}
        >
          {question.options.map((opt, i) => (
            <FBtn
              key={i}
              variant="secondary"
              block={true}
              disabled={blocked}
              onClick={() => onAnswer(opt)}
            >
              {opt}
            </FBtn>
          ))}
        </div>
        {blocked && (
          <div style={{ color: 'var(--danger-ink, #a23a25)', fontWeight: 700 }}>{blockedLabel}</div>
        )}
      </div>
    </div>
  );
}
