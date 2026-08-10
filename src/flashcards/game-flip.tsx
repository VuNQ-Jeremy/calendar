import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { shuffle, meaningOf, flashcardImagePath } from './game-utils.js';
import type { GameProps } from './game-utils.js';
import { RoundGardenNote, type GardenRoundProps } from '../garden/garden-widget.jsx';
import {
  COMMIT_RATIO,
  DRAG_SLOP_PX,
  EXIT_MS,
  arcLift,
  arcRotation,
  shouldCommit,
} from '../../shared/logic/flip-gesture';

const { Button: FBtn, IconButton: FIB } = DS;

/** Position on the pendulum arc for a horizontal drag offset. */
function arcTransform(dx: number): string {
  return `translate(${dx}px, ${arcLift(dx)}px) rotate(${arcRotation(dx)}deg)`;
}

const cardEnterCss = `
@keyframes fc-card-in {
  from { transform: translateY(14px) scale(.96); opacity: 0; }
  to { transform: none; opacity: 1; }
}
.fc-card-enter { animation: fc-card-in .22s ease-out; }
`;

type Gesture = {
  id: number | null; // active pointerId, null = no gesture
  startX: number;
  startY: number;
  dx: number;
  dragging: boolean; // true once movement passed DRAG_SLOP_PX horizontally
  prevX: number;
  prevT: number;
  vx: number; // last-sample velocity, px/ms
  raf: number;
};

/**
 * A card that has been swiped away and is still flying off screen.
 *
 * The game advances the instant a swipe COMMITS rather than when the exit animation ends, so the
 * next word can fade in underneath while the old card is still travelling. The outgoing card is
 * detached into one of these and animates itself out. `flipped` and `startDx` are captured at
 * commit time so it carries on from exactly the pose it was released in, showing the same face.
 */
type Ghost = {
  key: number;
  word: GameProps['words'][number];
  flipped: boolean;
  known: boolean;
  startDx: number;
};

/**
 * One outgoing card. Mounts at the pose it was released in, then animates off on its own timer and
 * asks the parent to drop it. Independent DOM nodes, so several can be in flight at once — rapid
 * swipes rain cards off the screen instead of queueing behind one another.
 */
function GhostCard({
  ghost,
  onDone,
  children,
}: {
  ghost: Ghost;
  onDone: (key: number) => void;
  children: React.ReactNode;
}) {
  const ref = React.useRef<HTMLDivElement | null>(null);

  React.useLayoutEffect(() => {
    const el = ref.current;
    if (el) {
      const width = el.offsetWidth || 480;
      const exitDx = (ghost.known ? 1 : -1) * (width * 1.4 + 120);
      // Commit the start pose, then force layout before switching the transition on — without the
      // reflow the browser coalesces both transforms and the card teleports instead of flying.
      el.style.transform = arcTransform(ghost.startDx);
      el.getBoundingClientRect();
      el.style.transition = `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out`;
      el.style.transform = arcTransform(exitDx);
      el.style.opacity = '0';
    }
    const timer = window.setTimeout(() => onDone(ghost.key), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [ghost, onDone]);

  return (
    <div
      ref={ref}
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'none',
        zIndex: 3,
        transform: arcTransform(ghost.startDx),
      }}
    >
      {children}
    </div>
  );
}

export function FlipGame({ words, onExit, onFinish, garden }: GameProps & GardenRoundProps) {
  const { t } = useLang();
  const [order, setOrder] = React.useState(() => words);
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Map<string, boolean>>(new Map());
  /** Cards that have been swiped away and are still flying off screen. */
  const [ghosts, setGhosts] = React.useState<Ghost[]>([]);
  const ghostKey = React.useRef(0);
  const finished = React.useRef(false);

  const dragRef = React.useRef<HTMLDivElement | null>(null);
  const knownBadgeRef = React.useRef<HTMLDivElement | null>(null);
  const unknownBadgeRef = React.useRef<HTMLDivElement | null>(null);
  const gesture = React.useRef<Gesture>({
    id: null,
    startX: 0,
    startY: 0,
    dx: 0,
    dragging: false,
    prevX: 0,
    prevT: 0,
    vx: 0,
    raf: 0,
  });
  const suppressClick = React.useRef(false); // a drag happened; swallow the trailing click

  // `idx` runs past the end while the last card is still flying out, so the round is only really
  // over once every ghost has landed. Everything gated on `done` waits for that.
  const done = idx >= order.length && ghosts.length === 0;

  React.useEffect(() => {
    if (done && !finished.current) {
      finished.current = true;
      const answers = order.map((w) => ({ wordId: w.id, correct: marks.get(w.id) === true }));
      onFinish({
        mode: 'flip',
        score: answers.filter((a) => a.correct).length,
        total: order.length,
        answers,
      });
    }
  }, [done, order, marks, onFinish]);

  /**
   * Detaches the current card as a ghost and moves to the next word, at COMMIT time.
   *
   * The ghost keeps painting the outgoing card on top while it finishes flying, so the next word
   * mounts and fades in underneath straight away instead of the screen sitting empty until the
   * exit animation reports back.
   */
  const advance = (known: boolean, startDx: number) => {
    const w = order[idx];
    if (!w) return;
    ghostKey.current += 1;
    setGhosts((g) => [...g, { key: ghostKey.current, word: w, flipped, known, startDx }]);
    setMarks((m) => new Map(m).set(w.id, known));
    setFlipped(false);
    setIdx((i) => i + 1);
  };

  const dropGhost = React.useCallback((key: number) => {
    setGhosts((g) => g.filter((x) => x.key !== key));
  }, []);

  const paint = () => {
    const g = gesture.current;
    g.raf = 0;
    const el = dragRef.current;
    if (!el) return;
    el.style.transform = arcTransform(g.dx);
    const commitPx = el.offsetWidth * COMMIT_RATIO;
    const p = Math.min(1, Math.abs(g.dx) / commitPx);
    if (knownBadgeRef.current) knownBadgeRef.current.style.opacity = g.dx > 0 ? String(p) : '0';
    if (unknownBadgeRef.current) unknownBadgeRef.current.style.opacity = g.dx < 0 ? String(p) : '0';
  };

  const settle = () => {
    const el = dragRef.current;
    if (el) {
      el.style.transition = 'transform .3s cubic-bezier(.2,.9,.3,1.2)';
      el.style.transform = '';
    }
    if (knownBadgeRef.current) knownBadgeRef.current.style.opacity = '0';
    if (unknownBadgeRef.current) unknownBadgeRef.current.style.opacity = '0';
  };

  /**
   * Hands the card off to a ghost, which owns the fly-out from here. The live card is reset to its
   * resting pose in the same breath — by the time the browser paints, it is already the next word.
   */
  const flyOut = (known: boolean, startDx: number) => {
    const el = dragRef.current;
    if (el) {
      el.style.transition = 'none';
      el.style.transform = '';
      el.style.opacity = '';
    }
    if (knownBadgeRef.current) knownBadgeRef.current.style.opacity = '0';
    if (unknownBadgeRef.current) unknownBadgeRef.current.style.opacity = '0';
    advance(known, startDx);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (gesture.current.id !== null) return;
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    suppressClick.current = false;
    const g = gesture.current;
    g.id = e.pointerId;
    g.startX = e.clientX;
    g.startY = e.clientY;
    g.dx = 0;
    g.dragging = false;
    g.prevX = e.clientX;
    g.prevT = e.timeStamp;
    g.vx = 0;
  };

  const onPointerMove = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.id !== e.pointerId) return;
    const dx = e.clientX - g.startX;
    const dyRaw = e.clientY - g.startY;
    if (!g.dragging) {
      if (Math.abs(dx) < DRAG_SLOP_PX) return;
      if (Math.abs(dyRaw) > Math.abs(dx)) {
        g.id = null; // vertical intent — hand the gesture back to the page (scroll)
        return;
      }
      g.dragging = true;
      suppressClick.current = true;
      dragRef.current?.setPointerCapture(e.pointerId);
      if (dragRef.current) dragRef.current.style.transition = 'none';
    }
    const dt = e.timeStamp - g.prevT;
    if (dt > 0) g.vx = (e.clientX - g.prevX) / dt;
    g.prevX = e.clientX;
    g.prevT = e.timeStamp;
    g.dx = dx;
    if (!g.raf) g.raf = requestAnimationFrame(paint);
  };

  const onPointerUp = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.id !== e.pointerId) return;
    g.id = null;
    if (g.raf) {
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    }
    if (!g.dragging) return; // plain tap — the click event will flip the card
    g.dragging = false;
    const el = dragRef.current;
    const width = el ? el.offsetWidth : 480;
    if (shouldCommit(g.dx, g.vx, width)) flyOut(g.dx > 0, g.dx);
    else settle();
  };

  const onPointerCancel = (e: React.PointerEvent) => {
    const g = gesture.current;
    if (g.id !== e.pointerId) return;
    g.id = null;
    g.dragging = false;
    if (g.raf) {
      cancelAnimationFrame(g.raf);
      g.raf = 0;
    }
    settle();
  };

  const replay = () => {
    finished.current = false;
    setMarks(new Map());
    setOrder(shuffle(words));
    setIdx(0);
    setFlipped(false);
    setGhosts([]);
  };

  /**
   * The card's two faces for one word. Shared by the live card and the ghosts so an outgoing card
   * keeps rendering exactly what it showed at the moment it was swiped.
   */
  const renderFaces = (word: Ghost['word'], isFlipped: boolean) => (
    <div
      style={{
        position: 'absolute',
        inset: 0,
        transformStyle: 'preserve-3d',
        transition: 'transform .4s',
        transform: isFlipped ? 'rotateY(180deg)' : 'none',
      }}
    >
      <div style={cardFace}>
        {word.imageKey && (
          // `flex: '0 1 55%'` with `minHeight: 0` lets the picture give way rather than pushing the
          // word, IPA and audio button off a short card. Pointer events stay off it so the drag and
          // flip handlers on the card itself keep working.
          <img
            src={flashcardImagePath(word.imageKey) ?? undefined}
            alt=""
            draggable={false}
            style={{
              width: 'calc(100% - 32px)',
              flex: '0 1 55%',
              minHeight: 0,
              objectFit: 'cover',
              borderRadius: 12,
              pointerEvents: 'none',
              userSelect: 'none',
            }}
          />
        )}
        <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{word.word}</div>
        {word.ipa && (
          <div style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}>
            {word.ipa}
          </div>
        )}
        <FIB
          label={t('fc_play_audio')}
          size="md"
          onClick={(e) => {
            e.stopPropagation();
            playWord(word.word);
          }}
        >
          <MIcon name="volume" size={22} />
        </FIB>
      </div>
      <div style={{ ...cardFace, transform: 'rotateY(180deg)' }}>
        <div style={{ fontSize: 'var(--text-lg, 24px)', fontWeight: 700 }}>{meaningOf(word)}</div>
        {word.meaningVi && word.definitionEn && (
          <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: '80%' }}>
            {word.definitionEn}
          </div>
        )}
      </div>
    </div>
  );

  if (done) {
    const known = order.filter((w) => marks.get(w.id) === true).length;
    const unknown = order.filter((w) => marks.get(w.id) !== true);
    return (
      <div style={endWrap}>
        <div style={{ fontSize: 'var(--text-xl, 28px)', fontWeight: 800 }}>
          {t('fc_round_done')}
        </div>
        <div style={{ fontSize: 'var(--text-lg, 22px)', color: 'var(--text-strong)' }}>
          {t('fc_score')}: {known}/{order.length}
        </div>
        <RoundGardenNote garden={garden} />
        {unknown.length > 0 && (
          <div style={{ width: '100%', maxWidth: 420 }}>
            <div style={{ fontWeight: 700, marginBottom: 6, color: 'var(--text-strong)' }}>
              {t('fc_review_unknown')}
            </div>
            <div className="m-stack" style={{ gap: 6 }}>
              {unknown.map((w) => (
                <div key={w.id} className="lrow" style={{ padding: '8px 12px' }}>
                  <span style={{ fontWeight: 600 }}>{w.word}</span>
                  <span style={{ marginLeft: 'auto', color: 'var(--text-muted)' }}>
                    {meaningOf(w)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="m-row" style={{ gap: 10 }}>
          <FBtn variant="primary" onClick={replay}>
            {t('fc_play_again')}
          </FBtn>
          <FBtn variant="secondary" onClick={onExit}>
            {t('fc_exit')}
          </FBtn>
        </div>
      </div>
    );
  }

  const w = order[idx];
  return (
    <div style={playWrap}>
      <style>{cardEnterCss}</style>
      <div style={{ color: 'var(--text-muted)', fontWeight: 600 }}>
        {Math.min(idx + 1, order.length)} / {order.length}
      </div>
      {/*
        Positioned, so the ghosts can overlay the live card in the same slot. It carries the card's
        aspect ratio itself rather than inheriting height from the live card — after the last word
        is swiped there IS no live card, and a zero-height wrapper would collapse the ghost still
        flying out of it.
      */}
      <div style={{ position: 'relative', width: 'min(90vw, 480px)', aspectRatio: '3 / 2' }}>
        {w && (
          <div
            key={w.id}
            ref={dragRef}
            className="fc-card-enter"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerCancel}
            onClick={() => {
              if (suppressClick.current) {
                suppressClick.current = false;
                return;
              }
              setFlipped((f) => !f);
            }}
            style={{
              position: 'relative',
              width: '100%',
              aspectRatio: '3 / 2',
              cursor: 'grab',
              userSelect: 'none',
              WebkitUserSelect: 'none',
              touchAction: 'pan-y',
              willChange: 'transform',
              perspective: 1200,
            }}
          >
            {renderFaces(w, flipped)}
            <div
              ref={knownBadgeRef}
              style={{
                ...swipeBadge,
                right: 14,
                top: 14,
                transform: 'rotate(8deg)',
                color: 'var(--ok, #16a34a)',
              }}
            >
              {t('fc_known')}
            </div>
            <div
              ref={unknownBadgeRef}
              style={{
                ...swipeBadge,
                left: 14,
                top: 14,
                transform: 'rotate(-8deg)',
                color: 'var(--danger, #dc2626)',
              }}
            >
              {t('fc_unknown')}
            </div>
          </div>
        )}

        {/* Cards already swiped away, still flying. Inert, and stacked above the live card. */}
        {ghosts.map((gh) => (
          <GhostCard key={gh.key} ghost={gh} onDone={dropGhost}>
            <div
              style={{
                position: 'relative',
                width: '100%',
                aspectRatio: '3 / 2',
                perspective: 1200,
              }}
            >
              {renderFaces(gh.word, gh.flipped)}
              <div
                style={{
                  ...swipeBadge,
                  opacity: 1,
                  ...(gh.known
                    ? { right: 14, transform: 'rotate(8deg)', color: 'var(--ok, #16a34a)' }
                    : { left: 14, transform: 'rotate(-8deg)', color: 'var(--danger, #dc2626)' }),
                  top: 14,
                }}
              >
                {gh.known ? t('fc_known') : t('fc_unknown')}
              </div>
            </div>
          </GhostCard>
        ))}
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
        {t('fc_flip_hint')} · {t('fc_swipe_hint')}
      </div>
      <div className="m-row" style={{ gap: 12 }}>
        <FBtn
          variant="danger"
          iconLeft={<MIcon name="x" size={16} />}
          onClick={() => flyOut(false, 0)}
        >
          {t('fc_unknown')}
        </FBtn>
        <FBtn
          variant="primary"
          iconLeft={<MIcon name="check" size={16} />}
          onClick={() => flyOut(true, 0)}
        >
          {t('fc_known')}
        </FBtn>
      </div>
    </div>
  );
}

const playWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 20,
  padding: 24,
  // The fly-out transform extends far past the viewport; without this the page
  // briefly grows a horizontal scrollbar as the card exits.
  overflowX: 'clip',
};

const endWrap: React.CSSProperties = {
  flex: 1,
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 18,
  padding: 24,
};

const cardFace: React.CSSProperties = {
  position: 'absolute',
  inset: 0,
  backfaceVisibility: 'hidden',
  WebkitBackfaceVisibility: 'hidden',
  background: 'var(--surface, #fff)',
  border: '1px solid var(--line, #e7e0d6)',
  borderRadius: 'var(--radius-lg, 20px)',
  boxShadow: '0 8px 30px rgba(0,0,0,.08)',
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  gap: 12,
  padding: 24,
};

const swipeBadge: React.CSSProperties = {
  position: 'absolute',
  zIndex: 2,
  padding: '4px 12px',
  border: '3px solid currentColor',
  borderRadius: 10,
  fontWeight: 800,
  fontSize: 'var(--text-md, 18px)',
  letterSpacing: 1,
  textTransform: 'uppercase',
  opacity: 0,
  pointerEvents: 'none',
  background: 'var(--surface, #fff)',
};
