import React from 'react';
import { DS } from '../ds/index.js';
import { MIcon } from '../icons.jsx';
import { useLang } from '../lib/i18n.jsx';
import { playWord } from './audio.js';
import { shuffle, meaningOf } from './game-utils.js';
import type { GameProps } from './game-utils.js';
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

export function FlipGame({ words, onExit, onFinish }: GameProps) {
  const { t } = useLang();
  const [order, setOrder] = React.useState(() => words);
  const [idx, setIdx] = React.useState(0);
  const [flipped, setFlipped] = React.useState(false);
  const [marks, setMarks] = React.useState<Map<string, boolean>>(new Map());
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
  const exiting = React.useRef(false); // fly-out animation in progress
  const suppressClick = React.useRef(false); // a drag happened; swallow the trailing click

  const done = idx >= order.length;

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

  const mark = (known: boolean) => {
    if (exiting.current) return; // ignore button presses while a card is flying out
    const w = order[idx];
    setMarks((m) => new Map(m).set(w.id, known));
    setFlipped(false);
    setIdx((i) => i + 1);
  };

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

  const flyOut = (known: boolean) => {
    exiting.current = true;
    const el = dragRef.current;
    const width = el ? el.offsetWidth : 480;
    const exitDx = (known ? 1 : -1) * (width * 1.4 + 120);
    if (el) {
      el.style.transition = `transform ${EXIT_MS}ms ease-out, opacity ${EXIT_MS}ms ease-out`;
      el.style.transform = arcTransform(exitDx);
      el.style.opacity = '0';
    }
    const badge = known ? knownBadgeRef.current : unknownBadgeRef.current;
    if (badge) badge.style.opacity = '1';
    window.setTimeout(() => {
      exiting.current = false;
      mark(known); // advances idx; key={w.id} remounts a clean card with the enter animation
    }, EXIT_MS);
  };

  const onPointerDown = (e: React.PointerEvent) => {
    if (exiting.current || gesture.current.id !== null) return;
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
    if (g.id !== e.pointerId || exiting.current) return;
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
    if (shouldCommit(g.dx, g.vx, width)) flyOut(g.dx > 0);
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
  };

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
        {idx + 1} / {order.length}
      </div>
      <div style={{ width: 'min(90vw, 480px)' }}>
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
            if (exiting.current) return;
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
          <div
            style={{
              position: 'absolute',
              inset: 0,
              transformStyle: 'preserve-3d',
              transition: 'transform .4s',
              transform: flipped ? 'rotateY(180deg)' : 'none',
            }}
          >
            <div style={cardFace}>
              <div style={{ fontSize: 'var(--text-xl, 32px)', fontWeight: 800 }}>{w.word}</div>
              {w.ipa && (
                <div
                  style={{ color: 'var(--text-muted)', fontFamily: 'var(--font-mono, monospace)' }}
                >
                  {w.ipa}
                </div>
              )}
              <FIB
                label={t('fc_play_audio')}
                size="md"
                onClick={(e) => {
                  e.stopPropagation();
                  playWord(w.word, w.audioUrl);
                }}
              >
                <MIcon name="volume" size={22} />
              </FIB>
            </div>
            <div style={{ ...cardFace, transform: 'rotateY(180deg)' }}>
              <div style={{ fontSize: 'var(--text-lg, 24px)', fontWeight: 700 }}>
                {meaningOf(w)}
              </div>
              {w.meaningVi && w.definitionEn && (
                <div style={{ color: 'var(--text-muted)', textAlign: 'center', maxWidth: '80%' }}>
                  {w.definitionEn}
                </div>
              )}
            </div>
          </div>
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
      </div>
      <div style={{ color: 'var(--text-muted)', fontSize: 'var(--text-sm)', textAlign: 'center' }}>
        {t('fc_flip_hint')} · {t('fc_swipe_hint')}
      </div>
      <div className="m-row" style={{ gap: 12 }}>
        <FBtn variant="danger" iconLeft={<MIcon name="x" size={16} />} onClick={() => mark(false)}>
          {t('fc_unknown')}
        </FBtn>
        <FBtn
          variant="primary"
          iconLeft={<MIcon name="check" size={16} />}
          onClick={() => mark(true)}
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
