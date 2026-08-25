import React from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MSelect } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { buildQuizQuestions, type QuizQuestion } from '../../shared/logic/flashcards';
import {
  faceoffAnswer,
  newFaceoff,
  FACEOFF_MAX_QUESTIONS,
  FACEOFF_TARGET,
  type FaceoffSide,
  type FaceoffState,
} from '../../shared/logic/pvp';
import type { FlashcardWordRow } from '../../server/services/flashcards.js';

const { Button: FBtn } = DS;

type LoaderData = {
  topic: { id: string; name: string };
  words: FlashcardWordRow[];
  students: { id: string; name: string }[];
  isStaff: boolean;
};

type Question = QuizQuestion<FlashcardWordRow>;

/**
 * The tabletop 1v1 face-off. The tablet lies flat with a player at each SHORT edge; the
 * left half is rotated -90deg toward its player, the right half +90deg toward its own — each
 * reads their own board upright while the opponent's runs sideways, by design. No networking:
 * one client builds the questions and runs the whole match, because there is only one device.
 */
export function FaceoffScreen() {
  const { topic, words, students, isStaff } = useLoaderData() as LoaderData;
  const { t } = useLang();
  const navigate = useNavigate();
  const resultFetcher = useFetcher();

  const [step, setStep] = React.useState<'setup' | 'play' | 'finish'>('setup');
  const [player1, setPlayer1] = React.useState<{ id: string; name: string } | null>(null);
  const [player2, setPlayer2] = React.useState<{ id: string; name: string } | null>(null);
  const [questions, setQuestions] = React.useState<Question[]>([]);
  const [state, setState] = React.useState<FaceoffState>(newFaceoff());
  const posted = React.useRef(false);

  const start = () => {
    setQuestions(buildQuizQuestions(words, FACEOFF_MAX_QUESTIONS));
    setState(newFaceoff());
    posted.current = false;
    setStep('play');
  };

  const answer = (side: FaceoffSide, option: string) => {
    const q = questions[state.qIndex];
    if (!q) return;
    const next = faceoffAnswer(state, side, option === q.answer, questions.length);
    setState(next);
    if (next.finished) setStep('finish');
  };

  const rematch = () => {
    setQuestions(buildQuizQuestions(words, FACEOFF_MAX_QUESTIONS));
    setState(newFaceoff());
    posted.current = false;
    setStep('play');
  };

  React.useEffect(() => {
    if (step !== 'finish' || posted.current) return;
    if (state.winner === null) return; // a draw is never recorded
    if (!player1 || !player2) return; // anonymous quick-play records nothing
    posted.current = true;
    const winnerId = state.winner === 1 ? player1.id : player2.id;
    const loserId = state.winner === 1 ? player2.id : player1.id;
    const winnerScore = state.winner === 1 ? state.scores[1] : state.scores[2];
    const loserScore = state.winner === 1 ? state.scores[2] : state.scores[1];
    const fd = new FormData();
    fd.set('intent', 'faceoff-result');
    fd.set('topicId', topic.id);
    fd.set('winnerStudentId', winnerId);
    fd.set('loserStudentId', loserId);
    fd.set('winnerScore', String(winnerScore));
    fd.set('loserScore', String(loserScore));
    fd.set('total', String(questions.length));
    resultFetcher.submit(fd, { method: 'post', action: '/game-rooms' });
  }, [step, state, player1, player2, topic.id, questions.length, resultFetcher]);

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
          <div style={{ color: 'var(--text-muted)', textAlign: 'center' }}>
            {t('pvp_faceoff_rule', { n: FACEOFF_TARGET })}
          </div>
          <FBtn variant="primary" size="lg" onClick={start}>
            {t('pvp_start')}
          </FBtn>
          <FBtn variant="ghost" onClick={() => navigate(`/vocabulary/${topic.id}`)}>
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
            {state.winner === null
              ? t('pvp_draw')
              : t('pvp_winner', {
                  name:
                    state.winner === 1
                      ? (player1?.name ?? t('pvp_player_1'))
                      : (player2?.name ?? t('pvp_player_2')),
                })}
          </div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)', fontSize: 20 }}>
            {state.scores[1]} — {state.scores[2]}
          </div>
          <div className="m-row" style={{ gap: 10 }}>
            <FBtn variant="primary" onClick={rematch}>
              {t('pvp_rematch')}
            </FBtn>
            <FBtn variant="secondary" onClick={() => navigate(`/vocabulary/${topic.id}`)}>
              {t('done')}
            </FBtn>
          </div>
        </div>
      </FullBleed>
    );
  }

  const q = questions[state.qIndex];
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
        rotateDeg={-90}
        question={q}
        locked={state.locked[1]}
        onAnswer={(opt) => answer(1, opt)}
        name={player1?.name}
      />
      <Divider qIndex={state.qIndex} total={questions.length} scores={state.scores} />
      <FaceoffHalf
        side={2}
        rotateDeg={90}
        question={q}
        locked={state.locked[2]}
        onAnswer={(opt) => answer(2, opt)}
        name={player2?.name}
      />
    </div>
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

function Divider({
  qIndex,
  total,
  scores,
}: {
  qIndex: number;
  total: number;
  scores: { 1: number; 2: number };
}) {
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
        {qIndex + 1}/{total}
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
              height: `${Math.min(100, (scores[1] / FACEOFF_TARGET) * 100)}%`,
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
              height: `${Math.min(100, (scores[2] / FACEOFF_TARGET) * 100)}%`,
              background: 'var(--cat-green-base, #6fb97a)',
              borderRadius: 999,
            }}
          />
        </div>
      </div>
      <div style={{ display: 'flex', gap: 6, fontWeight: 800 }}>
        <span>{scores[1]}</span>
        <span style={{ color: 'var(--text-muted)' }}>·</span>
        <span>{scores[2]}</span>
      </div>
    </div>
  );
}

function FaceoffHalf({
  side,
  rotateDeg,
  question,
  locked,
  onAnswer,
  name,
}: {
  side: FaceoffSide;
  rotateDeg: number;
  question: Question | undefined;
  locked: boolean;
  onAnswer: (option: string) => void;
  name?: string;
}) {
  const { t } = useLang();
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
          opacity: locked ? 0.45 : 1,
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
              disabled={locked}
              onClick={() => onAnswer(opt)}
            >
              {opt}
            </FBtn>
          ))}
        </div>
        {locked && (
          <div style={{ color: 'var(--danger-ink, #a23a25)', fontWeight: 700 }}>
            {t('pvp_faceoff_locked')}
          </div>
        )}
      </div>
    </div>
  );
}
