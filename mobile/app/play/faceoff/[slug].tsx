import React from 'react';
import { ActivityIndicator, Alert, ScrollView, View } from 'react-native';
import { router, useLocalSearchParams } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import { X } from 'lucide-react-native';
import { buildQuizQuestions, MIN_WORDS, type QuizQuestion } from '@mochi/shared/logic/flashcards';
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
} from '@mochi/shared/logic/pvp';
import * as api from '~/lib/endpoints';
import { useAuth } from '~/lib/auth';
import { useLang } from '~/lib/i18n';
import { useTopic } from '~/lib/use-topics';
import { useTheme, type Theme } from '~/theme';
import { Body, Button, Card, IconButton, Mono, Muted, ProgressBar, Screen, Title } from '~/ui';
import type { FlashcardWordRow } from '~/lib/types';

type Question = QuizQuestion<FlashcardWordRow>;
type FaceoffMode = 'duel' | 'race';
type Step = 'setup' | 'play' | 'finish';
type Player = { id: string; name: string } | null;

/**
 * The tabletop 1v1 face-off, mobile edition. Outside the `(app)` tab group (like
 * `play/battle/[code]`), which is what removes the tab bar.
 *
 * Portrait top/bottom at 180°, not the web's landscape ±90° — see the plan's rationale
 * (`.superpowers/sdd/2026-08-25-faceoff-on-mobile/unit-b-brief.md`): the web trick of swapping
 * width/height does not apply here because a 180° rotation preserves the bounding box.
 *
 * No networking: one device builds the questions and runs the whole match. Duel and Race are
 * driven by the two separate reducers in `shared/logic/pvp.ts` — no game rule lives here.
 */
export default function FaceoffScreen() {
  const th = useTheme();
  const { t } = useLang();
  const { user } = useAuth();
  const isStaff = user?.kind === 'staff';
  const { slug } = useLocalSearchParams<{ slug: string }>();
  const { bundle, loading, unavailableOffline } = useTopic(slug);

  const exit = React.useCallback(() => router.back(), []);

  // A match in progress forfeits on exit and cannot be undone, so the mid-game control confirms
  // first — the same shape `config.tsx`'s delete confirm uses. Reusing `pvp_faceoff_quit(_msg)`,
  // already shipped in both languages and unused on mobile until now. The hardware back button is
  // left alone: this is a detail route and back has never asked for confirmation here.
  const confirmQuit = React.useCallback(() => {
    Alert.alert(t('pvp_faceoff_quit'), t('pvp_faceoff_quit_msg'), [
      { text: t('cancel'), style: 'cancel' },
      { text: t('fc_exit'), style: 'destructive', onPress: exit },
    ]);
  }, [t, exit]);

  // Roster, staff only (Step 12). `/api/students` is `level: 'staff'` — fetching it from a
  // student's device would just surface a 403 as an error toast for no reason.
  const [roster, setRoster] = React.useState<{ id: string; name: string }[]>([]);
  React.useEffect(() => {
    if (!isStaff) return;
    let cancelled = false;
    api.students
      .list()
      .then((rows) => {
        if (!cancelled) setRoster(rows.map((r) => ({ id: r.id, name: r.name })));
      })
      .catch(() => {
        // The roster is a convenience picker, not a requirement to play — a failed fetch just
        // means no chips render, which is silently correct (unpicked players record nothing).
      });
    return () => {
      cancelled = true;
    };
  }, [isStaff]);

  const [step, setStep] = React.useState<Step>('setup');
  const [mode, setMode] = React.useState<FaceoffMode>('duel');
  const [player1, setPlayer1] = React.useState<Player>(null);
  const [player2, setPlayer2] = React.useState<Player>(null);
  const [questionCount, setQuestionCount] = React.useState<number>(RACE_DEFAULT_QUESTIONS);
  const [seconds, setSeconds] = React.useState<number>(RACE_DEFAULT_SECONDS);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [duel, setDuel] = React.useState<FaceoffState>(newFaceoff());
  const [race, setRace] = React.useState<RaceState>(() => newRace(RACE_DEFAULT_QUESTIONS));
  // Race only. `deadline` is epoch ms; `now` is what the countdown ticks so the clock and the
  // per-side cooldowns re-render.
  const [deadline, setDeadline] = React.useState<number | null>(null);
  const [now, setNow] = React.useState<number>(() => Date.now());
  const posted = React.useRef(false);
  // Set when the recording POST throws — offline (this screen's own `useTopic` supports playing a
  // downloaded topic with no connection) or the server's 422 `same_player`. The swallow below must
  // stay a swallow (the score is already on screen), but silence beyond that hides a real loss: the
  // match never reaches the ladder. Reset per match, not per screen, so a rematch gets a clean slate.
  const [recordFailed, setRecordFailed] = React.useState(false);

  // Also the rematch handler — mode and its pickers survive a match, so a rematch is just
  // another start.
  const start = React.useCallback(() => {
    if (!bundle) return;
    posted.current = false;
    setRecordFailed(false);
    // buildQuizQuestions caps a round at the DECK size, so a 6-word topic yields 6 questions even
    // when 10 were asked for. Seed the race from questions.length, never the picker, or
    // totalQuestions promises a question that is not there.
    const qs = buildQuizQuestions(
      bundle.words,
      mode === 'race' ? questionCount : FACEOFF_MAX_QUESTIONS,
    );
    setQuestions(qs);
    if (mode === 'race') {
      setRace(newRace(qs.length));
      setNow(Date.now());
      setDeadline(Date.now() + seconds * 1000);
    } else {
      setDuel(newFaceoff());
      setDeadline(null);
    }
    setStep('play');
  }, [bundle, mode, questionCount, seconds]);

  const answerDuel = React.useCallback(
    (side: FaceoffSide, option: string) => {
      const q = questions[duel.qIndex];
      if (!q) return;
      setDuel((s) => faceoffAnswer(s, side, option === q.answer, questions.length));
    },
    [questions, duel.qIndex],
  );

  const answerRace = React.useCallback(
    (side: FaceoffSide, option: string) => {
      // The tick that settles the expiry is 200ms wide, so a stale `race.finished` alone would
      // let a tap land after the buzzer and steal the win. Check the clock itself.
      if (deadline !== null && Date.now() >= deadline) return;
      const q = questions[race.progress[side]];
      if (!q) return;
      setRace((r) => raceAnswer(r, side, option === q.answer, Date.now()));
    },
    [questions, race.progress, deadline],
  );

  const answer = React.useCallback(
    (side: FaceoffSide, option: string) =>
      mode === 'race' ? answerRace(side, option) : answerDuel(side, option),
    [mode, answerRace, answerDuel],
  );

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

  // Both endings — someone won, or the clock ran out — set `finished` on the active game's
  // reducer, so one effect moves to the finish step for either.
  React.useEffect(() => {
    if (step !== 'play') return;
    const finished = mode === 'race' ? race.finished : duel.finished;
    if (finished) setStep('finish');
  }, [step, mode, race.finished, duel.finished]);

  // Duel scores points, Race counts questions cleared — one shape for the finish step and the
  // result post either way.
  const winner = mode === 'race' ? race.winner : duel.winner;
  const counts = mode === 'race' ? race.progress : duel.scores;
  const total = mode === 'race' ? race.totalQuestions : questions.length;

  React.useEffect(() => {
    if (step !== 'finish' || posted.current) return;
    if (winner === null) return; // a draw is never recorded
    if (!player1 || !player2) return; // anonymous quick-play records nothing
    if (!isStaff || !bundle) return; // students never post; the route is staff-only anyway
    posted.current = true;
    const winnerId = winner === 1 ? player1.id : player2.id;
    const loserId = winner === 1 ? player2.id : player1.id;
    const winnerScore = winner === 1 ? counts[1] : counts[2];
    const loserScore = winner === 1 ? counts[2] : counts[1];
    void (async () => {
      try {
        await api.pvp.recordFaceoff({
          mode: mode === 'race' ? 'quiz-race' : 'quiz-faceoff',
          topicId: bundle.topic.id,
          winnerStudentId: winnerId,
          loserStudentId: loserId,
          winnerScore,
          loserScore,
          total,
        });
      } catch {
        // The score is already on the finish screen; a failed record must not crash it — but it
        // must not vanish silently either (offline, or the server's 422 same_player), so the
        // finish screen renders one line about it.
        setRecordFailed(true);
      }
    })();
  }, [step, winner, counts, total, player1, player2, bundle, mode, isStaff]);

  // Offline with no downloaded copy — a dead end, so say so (Step 10, verbatim shape/copy).
  if (unavailableOffline) {
    return (
      <Screen edges={{ top: true, bottom: true }}>
        <View
          style={{ flex: 1, justifyContent: 'center', padding: th.spacing[6], gap: th.spacing[3] }}
        >
          <Body>{t('m_not_offline')}</Body>
          <Muted>{t('m_not_offline_sub')}</Muted>
          <Button variant="secondary" onPress={exit}>
            {t('fc_exit')}
          </Button>
        </View>
      </Screen>
    );
  }

  // Still loading, or too few words to build a round at all (Step 11) — same friendly dead end.
  if (!bundle || bundle.words.length < MIN_WORDS.quiz) {
    return (
      <Screen edges={{ top: true, bottom: true }}>
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: th.spacing[4] }}
        >
          {loading ? (
            <ActivityIndicator color={th.color.brand} />
          ) : (
            <>
              <Muted>
                {!bundle || bundle.words.length === 0
                  ? t('fc_no_words')
                  : t('fc_min_words', { n: MIN_WORDS.quiz })}
              </Muted>
              <Button variant="secondary" onPress={exit}>
                {t('fc_exit')}
              </Button>
            </>
          )}
        </View>
      </Screen>
    );
  }

  if (step === 'setup') {
    return (
      <Screen scroll edges={{ top: true, bottom: true }}>
        <StatusBar style="dark" />
        <View style={{ gap: th.spacing[1], alignItems: 'center' }}>
          <Title>{bundle.topic.name}</Title>
        </View>

        <Card style={{ gap: th.spacing[4] }}>
          <View style={{ gap: th.spacing[3] }}>
            <View style={{ gap: th.spacing[1] }}>
              <Button
                variant={mode === 'duel' ? 'primary' : 'soft'}
                size="lg"
                block
                onPress={() => setMode('duel')}
              >
                {t('pvp_faceoff_mode_duel')}
              </Button>
              <Muted style={{ textAlign: 'center' }}>{t('pvp_faceoff_mode_duel_sub')}</Muted>
            </View>
            <View style={{ gap: th.spacing[1] }}>
              <Button
                variant={mode === 'race' ? 'primary' : 'soft'}
                size="lg"
                block
                onPress={() => setMode('race')}
              >
                {t('pvp_faceoff_mode_race')}
              </Button>
              <Muted style={{ textAlign: 'center' }}>{t('pvp_faceoff_mode_race_sub')}</Muted>
            </View>
          </View>

          {mode === 'race' && (
            <View style={{ gap: th.spacing[3] }}>
              {/* flexWrap: the Card's inner width at 360dp (a real budget phone) is ~269dp — a
                  label plus three md buttons needs ~299dp unwrapped, so the last option is drawn
                  past the Card's edge and cut off. Wrapping lets the overflowing button drop to
                  its own line instead of being clipped. */}
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: th.spacing[2],
                }}
              >
                <Muted>{t('fc_round_size')}:</Muted>
                {RACE_QUESTION_COUNTS.map((n) => (
                  <Button
                    key={n}
                    variant={questionCount === n ? 'primary' : 'soft'}
                    onPress={() => setQuestionCount(n)}
                  >
                    {String(n)}
                  </Button>
                ))}
              </View>
              <View
                style={{
                  flexDirection: 'row',
                  flexWrap: 'wrap',
                  alignItems: 'center',
                  gap: th.spacing[2],
                }}
              >
                <Muted>{t('pvp_race_duration')}:</Muted>
                {RACE_SECONDS_CHOICES.map((n) => (
                  <Button
                    key={n}
                    variant={seconds === n ? 'primary' : 'soft'}
                    onPress={() => setSeconds(n)}
                  >
                    {`${n}s`}
                  </Button>
                ))}
              </View>
            </View>
          )}

          {isStaff && (
            <View style={{ gap: th.spacing[4] }}>
              {/* A school with hundreds of students would want a searchable picker instead of a
                  chip row — proportionate for a class-sized roster only. */}
              <PlayerSlot
                th={th}
                label={t('pvp_player_1')}
                roster={roster}
                selected={player1}
                onSelect={setPlayer1}
              />
              <PlayerSlot
                th={th}
                label={t('pvp_player_2')}
                roster={roster}
                selected={player2}
                onSelect={setPlayer2}
              />
            </View>
          )}

          <View style={{ gap: th.spacing[3], alignItems: 'center' }}>
            <Button variant="primary" size="lg" block onPress={start}>
              {t('pvp_start')}
            </Button>
            {mode === 'duel' && (
              <Muted style={{ textAlign: 'center' }}>
                {t('pvp_faceoff_rule', { n: FACEOFF_TARGET })}
              </Muted>
            )}
            <Button variant="ghost" onPress={exit}>
              {t('fc_exit')}
            </Button>
          </View>
        </Card>
      </Screen>
    );
  }

  if (step === 'finish') {
    return (
      <Screen edges={{ top: true, bottom: true }}>
        <StatusBar style="dark" />
        <View
          style={{ flex: 1, justifyContent: 'center', alignItems: 'center', gap: th.spacing[4] }}
        >
          <Title style={{ ...th.text.xl, fontFamily: th.font.displayBold }}>
            {winner === null
              ? t('pvp_draw')
              : t('pvp_winner', {
                  name:
                    winner === 1
                      ? (player1?.name ?? t('pvp_player_1'))
                      : (player2?.name ?? t('pvp_player_2')),
                })}
          </Title>
          <Mono style={{ ...th.text.xl }}>
            {counts[1]} — {counts[2]}
          </Mono>
          {recordFailed ? <Muted>{t('pvp_faceoff_not_recorded')}</Muted> : null}
          <View style={{ flexDirection: 'row', gap: th.spacing[3] }}>
            <Button variant="primary" onPress={start}>
              {t('pvp_rematch')}
            </Button>
            <Button variant="secondary" onPress={exit}>
              {t('done')}
            </Button>
          </View>
        </View>
      </Screen>
    );
  }

  // step === 'play'
  const isRace = mode === 'race';
  // Duel shows both players the same question; Race hands each side the one at its own progress.
  const questionFor = (side: FaceoffSide): Question | undefined =>
    isRace ? questions[race.progress[side]] : questions[duel.qIndex];
  const blockedFor = (side: FaceoffSide): boolean =>
    isRace ? now < race.blockedUntil[side] : duel.locked[side];
  const blockedLabel = isRace ? t('pvp_race_cooldown') : t('pvp_faceoff_locked');
  const fillDenominator = isRace ? Math.max(1, race.totalQuestions) : FACEOFF_TARGET;
  const secondsLeft =
    deadline === null ? 0 : Math.max(0, Math.ceil((deadline - Math.min(now, deadline)) / 1000));
  const centerLabel = isRace
    ? `${Math.floor(secondsLeft / 60)}:${String(secondsLeft % 60).padStart(2, '0')}`
    : `${duel.qIndex + 1}/${questions.length}`;

  const board = (side: FaceoffSide) => {
    const q = questionFor(side);
    const name = side === 1 ? player1?.name : player2?.name;
    const blocked = blockedFor(side);
    if (!q) return <View style={{ flex: 1 }} />;
    return (
      <View
        style={{
          flex: 1,
          position: 'relative',
          alignItems: 'center',
          justifyContent: 'center',
          // Trimmed from spacing[4] (16) in the second fix-wave pass: the worst case — a wrapped
          // two-line word — needed the room back to stay inside the 299dp per-board budget on a
          // 360x800 phone. See the unit report for the arithmetic.
          gap: th.spacing[3],
          padding: th.spacing[4],
          opacity: blocked ? 0.45 : 1,
        }}
      >
        {name ? <Body style={{ fontFamily: th.font.bodyBold }}>{name}</Body> : null}
        <Title style={{ ...th.text.xxl, fontFamily: th.font.displayBold, textAlign: 'center' }}>
          {q.word.word}
        </Title>
        {/* 2x2, not a single column: a 4-row column of 52dp buttons overflows a portrait half on
            every real phone width; two rows fits the same budget with room to spare — see the
            fix-wave arithmetic in the unit report. `flexBasis` instead of `block`: `block` forces
            each button to the row's full width, which would defeat the wrap into 2 columns. */}
        <View
          style={{
            width: '100%',
            flexDirection: 'row',
            flexWrap: 'wrap',
            gap: th.spacing[2],
          }}
        >
          {q.options.map((opt, i) => (
            <Button
              key={`${side}-${i}-${opt}`}
              variant="secondary"
              size="lg"
              // `Button`'s inner Text is a hardcoded `numberOfLines={1}` with no wrap escape, and
              // at 48% of a ~330dp board this cell is only ~155dp wide. `Button`'s own
              // `paddingHorizontal: spacing[8]` (32dp/side) was written for a full-width button,
              // not a half-width grid cell, and left only ~90dp for the label — enough to
              // ellipsize any option sourced from `definitionEn` (meaningVi is optional; see
              // shared/schemas.ts). The `style` prop is spread last in Button's own style array,
              // so this override wins over the base `paddingHorizontal` (RN's array-style
              // flattening is last-write-wins per key) — no edit to the shared Button needed.
              style={{ flexBasis: '48%', paddingHorizontal: th.spacing[2] }}
              disabled={blocked}
              onPress={() => answer(side, opt)}
            >
              {opt}
            </Button>
          ))}
        </View>
        {/* Absolutely positioned, not a flow sibling (third fix-wave pass): a blocked board is
            routine, not rare — Duel locks a side on every miss — so its 12dp gap + 20dp height
            was a permanent tax on the worst-case (wrapped-word) budget, not an occasional one.
            The board is already dimmed to opacity 0.45 when blocked, so overlaying costs nothing
            visually. It sits INSIDE this same View, which is what keeps it under `board(1)`'s
            180° rotation wrapper — a label placed outside that transform would read upside down
            to the top-edge player it exists to inform. `pointerEvents: 'none'`: once a side
            unblocks (the cooldown ends in Race, the question advances in Duel) a stray overlay
            left sitting above the option buttons must not silently eat the next tap. */}
        {blocked ? (
          <View
            pointerEvents="none"
            style={{
              position: 'absolute',
              top: 0,
              left: 0,
              right: 0,
              bottom: 0,
              alignItems: 'center',
              justifyContent: 'center',
            }}
          >
            <Muted>{blockedLabel}</Muted>
          </View>
        ) : null}
      </View>
    );
  };

  return (
    <Screen edges={{ top: true, bottom: true }}>
      <StatusBar style="dark" />
      <View style={{ flex: 1 }}>
        {/* 180° — not the web's ±90°. A phone is portrait-locked, so the two players sit at the
            top and bottom short edges rather than the left and right. Player 1 sits at the TOP
            edge: unrotated content has its "up" pointing toward player 1 (toward them, not away),
            which is upside down for someone reading from that edge — the same "letter-tops point
            away from the reader" rule the web version follows for its two side-seated players.
            Rotating player 1's board 180° flips its "up" to point toward player 2's edge instead
            (away from player 1), which is what makes it read upright FOR PLAYER 1. Player 2 sits
            at the bottom edge, where the screen's default "up" already points away from them, so
            their board stays unrotated. A 180° rotation also preserves the bounding box, so
            unlike the web version this needs no swapped width/height: RN maps touches through the
            transform, and because the bounds are unchanged every option button stays
            hit-testable where it is drawn. */}
        <View style={{ flex: 1, transform: [{ rotate: '180deg' }] }}>{board(1)}</View>
        <Divider
          th={th}
          t={t}
          fill1={(counts[1] / fillDenominator) * 100}
          fill2={(counts[2] / fillDenominator) * 100}
          centerLabel={centerLabel}
          onQuit={confirmQuit}
        />
        <View style={{ flex: 1 }}>{board(2)}</View>
      </View>
    </Screen>
  );
}

/**
 * The unrotated strip between the two boards (Step 16). Nothing in it rotates — the numerals
 * read from either side and the exit belongs to neither player — so it is a plain styled `View`,
 * not the web face-off's own `Divider` component (there is no shared primitive for it, and this
 * is its only use).
 */
function Divider({
  th,
  t,
  fill1,
  fill2,
  centerLabel,
  onQuit,
}: {
  th: Theme;
  t: (key: string, vars?: Record<string, string | number>) => string;
  /** 0-100 — ProgressBar clamps, so an over-target duel score cannot overflow the track. */
  fill1: number;
  fill2: number;
  centerLabel: string;
  onQuit: () => void;
}) {
  // No separate score row: the two ProgressBars already carry the same number as a fill, and
  // cutting the redundant text row buys ~28dp of divider height back for the boards above and
  // below (see the fix-wave arithmetic in the unit report).
  return (
    <View
      style={{
        gap: th.spacing[2],
        paddingVertical: th.spacing[3],
        paddingHorizontal: th.spacing[4],
        backgroundColor: th.color.surfaceSunken,
      }}
    >
      <ProgressBar value={fill1} color="violet" />
      <Mono style={{ textAlign: 'center' }}>{centerLabel}</Mono>
      <View style={{ alignItems: 'center' }}>
        <IconButton label={t('pvp_faceoff_quit')} onPress={onQuit}>
          <X size={20} color={th.color.textMuted} />
        </IconButton>
      </View>
      <ProgressBar value={fill2} color="green" />
    </View>
  );
}

/**
 * One setup-step player slot: a horizontally scrollable row of chips, one per roster student.
 * Stands in for a Select — `mobile/ui` has none, and there is no existing student-picker screen
 * to copy from.
 */
function PlayerSlot({
  th,
  label,
  roster,
  selected,
  onSelect,
}: {
  th: Theme;
  label: string;
  roster: { id: string; name: string }[];
  selected: Player;
  onSelect: (s: Player) => void;
}) {
  return (
    <View style={{ gap: th.spacing[2] }}>
      <Muted>{label}</Muted>
      <ScrollView horizontal showsHorizontalScrollIndicator={false}>
        <View style={{ flexDirection: 'row', gap: th.spacing[2] }}>
          {roster.map((s) => (
            <Button
              key={s.id}
              variant={selected?.id === s.id ? 'primary' : 'soft'}
              onPress={() => onSelect(s)}
            >
              {s.name}
            </Button>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}
