import React from 'react';
import { useFetcher, useLoaderData, useNavigate } from 'react-router';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useConfirm } from '../ui.jsx';
import { useLang } from '../lib/i18n.jsx';
import { useGameSocket } from '../lib/game-socket.js';
import { playWord } from './audio.js';
import { myResultFromReveals } from '../../shared/logic/pvp';
import type { WireQuizQuestion } from '../../shared/logic/pvp';

const { Button: FBtn, IconButton: FIB } = DS;

type LoaderData = { code: string; myId: string; myKind: 'staff' | 'student' | 'parent' };

/** Every 'error' phase code maps to a literal i18n key, so check-i18n can see them all. */
function errorMessageKey(code: string): string {
  switch (code) {
    case 'not_found':
      return 'pvp_error_not_found';
    case 'already_started':
      return 'pvp_error_already_started';
    case 'full':
      return 'pvp_error_full';
    case 'not_host':
      return 'pvp_error_not_host';
    case 'connection_lost':
      return 'pvp_error_connection_lost';
    default:
      return 'pvp_error_generic';
  }
}

/**
 * The join-by-code battle screen. Renders every phase off the shared `PvpView` reducer state —
 * `useGameSocket` is transport only, so this component and the mobile one share no code but
 * cannot disagree about what a phase means.
 */
export function BattleScreen() {
  const { code, myId, myKind } = useLoaderData() as LoaderData;
  const { t } = useLang();
  const navigate = useNavigate();
  const { view, send } = useGameSocket(code);
  const resultFetcher = useFetcher();

  // Bookkeeping for the standard GameResult a student posts at finish: each question's wordId
  // (learned from the 'question' message) paired with whether MY answer to it was correct
  // (learned from the matching 'reveal').
  const wordIdByIndex = React.useRef<Record<number, string>>({});
  const myReveals = React.useRef<{ index: number; correct: boolean; wordId: string }[]>([]);
  const startedAt = React.useRef<number | null>(null);
  const posted = React.useRef(false);

  if (view.phase === 'question' && startedAt.current === null) startedAt.current = Date.now();
  if (view.phase === 'question') wordIdByIndex.current[view.index] = view.question.wordId;
  if (view.phase === 'reveal') {
    const wordId = wordIdByIndex.current[view.index];
    if (wordId && !myReveals.current.some((r) => r.index === view.index)) {
      myReveals.current.push({
        index: view.index,
        correct: view.correctIds.includes(myId),
        wordId,
      });
    }
  }

  React.useEffect(() => {
    // A fresh mount onto an already-finished room has no answers of its own; posting
    // total: 0 is rejected by the server as 422.
    if (
      view.phase !== 'finish' ||
      posted.current ||
      myKind !== 'student' ||
      myReveals.current.length === 0
    )
      return;
    posted.current = true;
    const result = myResultFromReveals(
      myReveals.current,
      Date.now() - (startedAt.current ?? Date.now()),
    );
    const fd = new FormData();
    fd.set('intent', 'record-result');
    fd.set('topicId', view.config.topicId);
    fd.set('mode', result.mode);
    fd.set('score', String(result.score));
    fd.set('total', String(result.total));
    fd.set('durationMs', String(result.durationMs));
    fd.set('answers', JSON.stringify(result.answers));
    resultFetcher.submit(fd, { method: 'post', action: `/vocabulary/${view.config.slug}` });
  }, [view, myId, myKind, resultFetcher]);

  const isProjector = myKind === 'staff';

  /**
   * Leaving mid-battle. The `finish` and `error` phases carry their own way out, but without this
   * the lobby, the questions and the reveals had none at all — and this screen is a full-bleed
   * fixed overlay outside the app shell, so on a classroom tablet with no browser chrome there was
   * no way off it but to play to the end.
   *
   * Only a battle IN PROGRESS asks for confirmation: the DO keeps a player in `players` after a
   * disconnect, so leaving costs the current question and nothing more — you rejoin on the same
   * code. Leaving a lobby costs nothing, so it just goes.
   */
  const [confirm, confirmNode] = useConfirm();
  const confirmPending = React.useRef(false);
  const inProgress = view.phase === 'question' || view.phase === 'reveal';
  const leave = React.useCallback(async () => {
    if (confirmPending.current) return; // Escape must not re-enter its own confirm
    if (!inProgress) {
      navigate('/vocabulary');
      return;
    }
    confirmPending.current = true;
    try {
      const ok = await confirm({
        title: t('pvp_leave_battle'),
        message: t('pvp_leave_battle_msg'),
        confirmLabel: t('fc_exit'),
        danger: true,
      });
      if (ok) navigate('/vocabulary');
    } finally {
      confirmPending.current = false;
    }
  }, [confirm, inProgress, navigate, t]);

  const showLeave =
    view.phase === 'connecting' ||
    view.phase === 'lobby' ||
    view.phase === 'question' ||
    view.phase === 'reveal';

  React.useEffect(() => {
    if (!showLeave) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') void leave();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [showLeave, leave]);

  return (
    <div
      style={{
        position: 'fixed',
        inset: 0,
        background: 'var(--bg-app, #faf7f2)',
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 24,
        padding: 24,
        fontFamily: 'var(--font-body)',
      }}
    >
      {showLeave && (
        <div style={{ position: 'absolute', top: 16, right: 16 }}>
          <FBtn
            variant="secondary"
            iconLeft={<MIcon name="x" size={16} />}
            onClick={() => void leave()}
          >
            {t('fc_exit')}
          </FBtn>
        </div>
      )}

      {view.phase === 'connecting' && <div>{t('pvp_connecting')}</div>}

      {view.phase === 'error' && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 16, alignItems: 'center' }}>
          <div>{t(errorMessageKey(view.code))}</div>
          <FBtn variant="secondary" onClick={() => navigate('/vocabulary')}>
            {t('fc_exit')}
          </FBtn>
        </div>
      )}

      {view.phase === 'lobby' && (
        <Lobby
          view={view}
          myId={myId}
          onStart={() => send({ type: 'start' })}
          isProjector={isProjector}
        />
      )}

      {view.phase === 'question' && (
        <QuestionPhase
          view={view}
          onAnswer={(option) => send({ type: 'answer', index: view.index, option })}
          isProjector={isProjector}
        />
      )}

      {view.phase === 'reveal' && <RevealPhase view={view} myId={myId} isProjector={isProjector} />}

      {view.phase === 'finish' && (
        <FinishPhase view={view} myId={myId} onExit={() => navigate('/vocabulary')} />
      )}

      {confirmNode}
    </div>
  );
}

function Lobby({
  view,
  myId,
  onStart,
  isProjector,
}: {
  view: Extract<ReturnType<typeof useGameSocket>['view'], { phase: 'lobby' }>;
  myId: string;
  onStart: () => void;
  isProjector: boolean;
}) {
  const { t } = useLang();
  const isHost = view.hostId === myId;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 20,
        alignItems: 'center',
        maxWidth: 560,
      }}
    >
      <div style={{ color: 'var(--text-muted)' }}>{t('pvp_room_code')}</div>
      <div style={{ display: 'flex', gap: isProjector ? 16 : 8 }}>
        {[...view.code].map((ch, i) => (
          <div
            key={i}
            style={{
              width: isProjector ? 100 : 58,
              height: isProjector ? 120 : 68,
              background: 'var(--brand-soft, #ffe7d1)',
              border: '2px solid var(--brand, #f79a4e)',
              borderRadius: 20,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              fontSize: isProjector ? 64 : 32,
              fontWeight: 700,
              color: 'var(--brand-ink, #b0521a)',
            }}
          >
            {ch}
          </div>
        ))}
      </div>
      <div className="m-row" style={{ gap: 8, flexWrap: 'wrap', justifyContent: 'center' }}>
        {view.players.map((p) => (
          <span
            key={p.id}
            className="mochi-badge"
            style={{ fontWeight: p.id === myId ? 800 : 600 }}
          >
            {p.name}
          </span>
        ))}
      </div>
      <div style={{ color: 'var(--text-muted)' }}>
        {t('pvp_player_count', { n: view.players.length })}
      </div>
      {isHost ? (
        <FBtn
          variant="primary"
          size="lg"
          disabled={view.players.length < 2}
          iconLeft={<MIcon name="chevronRight" size={18} />}
          onClick={onStart}
        >
          {t('pvp_start')}
        </FBtn>
      ) : (
        <div style={{ color: 'var(--text-muted)' }}>{t('pvp_waiting_host')}</div>
      )}
    </div>
  );
}

function OptionsGrid({
  question,
  picked,
  correctOption,
  onPick,
  isProjector,
}: {
  question: WireQuizQuestion;
  picked: string | null;
  correctOption: string | null;
  onPick?: (option: string) => void;
  isProjector: boolean;
}) {
  return (
    <div
      style={{
        display: 'grid',
        gridTemplateColumns: '1fr 1fr',
        gap: 12,
        width: isProjector ? 'min(90vw, 900px)' : 'min(90vw, 520px)',
      }}
    >
      {question.options.map((opt, i) => {
        let variant: 'secondary' | 'primary' | 'danger' = 'secondary';
        if (correctOption) {
          if (opt === correctOption) variant = 'primary';
          else if (opt === picked) variant = 'danger';
        } else if (opt === picked) {
          variant = 'primary';
        }
        return (
          <FBtn
            key={i}
            variant={variant}
            block={true}
            disabled={!onPick || Boolean(picked) || Boolean(correctOption)}
            onClick={() => onPick?.(opt)}
          >
            {opt}
          </FBtn>
        );
      })}
    </div>
  );
}

function QuestionPhase({
  view,
  onAnswer,
  isProjector,
}: {
  view: Extract<ReturnType<typeof useGameSocket>['view'], { phase: 'question' }>;
  onAnswer: (option: string) => void;
  isProjector: boolean;
}) {
  const { t } = useLang();
  const [now, setNow] = React.useState(Date.now());
  React.useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 200);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, view.deadline - now);
  const pct = Math.max(0, Math.min(1, remaining / (view.config.secondsPerQuestion * 1000)));

  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        width: '100%',
      }}
    >
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: view.index + 1, n: view.total })}
      </div>
      <div
        style={{
          width: 'min(90vw, 520px)',
          height: 8,
          background: 'var(--surface-sunken, #f2e9db)',
          borderRadius: 999,
        }}
      >
        <div
          style={{
            width: `${pct * 100}%`,
            height: 8,
            background: 'var(--brand, #f79a4e)',
            borderRadius: 999,
            transition: 'width 0.2s linear',
          }}
        />
      </div>
      <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 10 }}>
        {view.question.prompt === 'image' ? (
          <>
            {view.question.imagePath && (
              <img
                src={view.question.imagePath}
                alt=""
                style={{
                  width: isProjector ? 320 : 200,
                  aspectRatio: '3 / 2',
                  objectFit: 'cover',
                  borderRadius: 14,
                  border: '1px solid var(--line, #e7e0d6)',
                }}
              />
            )}
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_pick_word')}</div>
          </>
        ) : view.question.prompt === 'audio' ? (
          <>
            <FIB
              label={t('fc_play_audio')}
              size="md"
              onClick={() => playWord(view.question.promptText)}
            >
              <MIcon name="volume" size={32} />
            </FIB>
            <div style={{ color: 'var(--text-muted)' }}>{t('fc_listen_pick')}</div>
          </>
        ) : (
          <div style={{ fontSize: isProjector ? 64 : 32, fontWeight: 800 }}>
            {view.question.promptText}
          </div>
        )}
      </div>
      <OptionsGrid
        question={view.question}
        picked={view.myAnswer}
        correctOption={null}
        onPick={onAnswer}
        isProjector={isProjector}
      />
    </div>
  );
}

function RevealPhase({
  view,
  myId,
  isProjector,
}: {
  view: Extract<ReturnType<typeof useGameSocket>['view'], { phase: 'reveal' }>;
  myId: string;
  isProjector: boolean;
}) {
  const { t } = useLang();
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        alignItems: 'center',
        gap: 20,
        width: '100%',
      }}
    >
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {t('fc_question_of', { i: view.index + 1, n: view.config.totalQuestions })}
      </div>
      {view.correctIds.includes(myId) && (
        <div
          className="m-row"
          style={{ gap: 8, alignItems: 'center', color: 'var(--success-ink, #356b40)' }}
        >
          <MIcon name="check" size={18} />
          <span>{t('pvp_you_got_it')}</span>
        </div>
      )}
      <Standings standings={view.standings} myId={myId} isProjector={isProjector} />
    </div>
  );
}

function Standings({
  standings,
  myId,
  isProjector,
}: {
  standings: { id: string; name: string; score: number; correct: number }[];
  myId: string;
  isProjector: boolean;
}) {
  return (
    <div
      style={{
        width: isProjector ? 'min(90vw, 640px)' : 'min(90vw, 420px)',
        display: 'flex',
        flexDirection: 'column',
        gap: 8,
      }}
    >
      {standings.map((s, i) => (
        <div
          key={s.id}
          className="m-row"
          style={{
            gap: 12,
            alignItems: 'center',
            padding: '8px 12px',
            borderRadius: 12,
            background: s.id === myId ? 'var(--brand-soft, #fff4ea)' : 'transparent',
          }}
        >
          <div style={{ width: 24, fontWeight: 800, color: 'var(--text-muted)' }}>{i + 1}</div>
          <div style={{ flex: 1, fontWeight: s.id === myId ? 800 : 600 }}>{s.name}</div>
          <div style={{ fontFamily: 'var(--font-mono, monospace)' }}>{s.score}</div>
        </div>
      ))}
    </div>
  );
}

function FinishPhase({
  view,
  myId,
  onExit,
}: {
  view: Extract<ReturnType<typeof useGameSocket>['view'], { phase: 'finish' }>;
  myId: string;
  onExit: () => void;
}) {
  const { t } = useLang();
  const myRank = view.standings.findIndex((s) => s.id === myId) + 1;
  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 20 }}>
      <MIcon name="trophy" size={40} />
      <div style={{ fontSize: 28, fontWeight: 800 }}>{t('pvp_finished')}</div>
      {myRank > 0 && (
        <div style={{ color: 'var(--text-muted)' }}>
          {t('pvp_your_rank', { n: myRank, total: view.standings.length })}
        </div>
      )}
      <Standings standings={view.standings} myId={myId} isProjector={false} />
      <FBtn variant="primary" onClick={onExit}>
        {t('done')}
      </FBtn>
    </div>
  );
}
